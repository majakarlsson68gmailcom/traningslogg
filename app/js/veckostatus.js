// Överhoppade pass: "ej genomfört" per vecka. All logik för funktionen bor här,
// vyerna ritar bara. Loggflödet i views/pass.js rörs inte av den här filen.
//
// Två lager, av samma skäl som synk aldrig rör en öppen session:
//   1. settings, nyckel `vecka:2026-W32` → { markerade, emitterade, hanterad }
//      Muterbart. En PÅGÅENDE vecka lever bara här, så ångra är alltid gratis.
//   2. sets-storen → statusrad med synced=0, går genom befintlig synkmotor.
//      Skrivs (emitteras) först när veckan är slut och är då orörlig, precis
//      som ett synkat set.
//
// Statusraden är ett tillägg till datakontraktet, godkänt av användaren:
//   {"datum":"<veckans söndag>","pass":"lower2","status":"ej_genomfort",
//    "vecka":"2026-W32","ts":"…"}
// Den saknar `ovning` och hamnar därför aldrig i ovning_tid-indexet — men den
// ligger i datum-indexet, så anropare av rowsForDatum måste filtrera på !r.status.

import { addSet, deleteSet, getSetting, setSetting, rowsForDatum } from './db.js';
import { nuISO, veckoEtikett, veckaFor, foregaendeVecka, LOPPASS_ID } from './format.js';

const TOM = { markerade: [], emitterade: [], hanterad: false };

async function hamtaVeckopost(vecka) {
  return { ...TOM, ...((await getSetting(`vecka:${vecka}`)) || {}) };
}

async function sparaVeckopost(vecka, post) {
  await setSetting(`vecka:${vecka}`, post);
}

/* ---------- veckogränser ---------- */

// Bara MANUELLA veckostarter lagras. Kalenderveckor härleds, så en tom lista
// betyder "vanliga ISO-veckor" och inget behöver fyllas i i förväg.
// Egen nyckel utan `vecka:`-prefix — det keyspacet ägs av hamtaVeckopost.
export async function veckostarter() {
  return (await getSetting('veckostarter')) || [];
}

// Startar en ny vecka på `start`. Anroparen väljer dagen, för de två fallen
// skiljer sig: står man på morgonen och ska träna hör DAGEN till den nya
// veckan, medan man på kvällen efter sista passet vill att den börjar i morgon.
// Idempotent — två tryck på samma dag ger en gräns, inte två.
export async function borjaNyVecka(start) {
  const starter = await veckostarter();
  if (starter.includes(start)) return starter;
  const uppdaterade = [...starter, start].sort();
  await setSetting('veckostarter', uppdaterade);
  return uppdaterade;
}

export async function markeradeFor(vecka) {
  return (await hamtaVeckopost(vecka)).markerade;
}

// Passen som har minst ett loggat set någon dag i veckan.
// Vilka av PROGRAMMETS pass som har loggade set i perioden. Löppass räknas inte:
// de står utanför pass-listan, och veckoavstämningen använder tomma mängden som
// signal för "appen vet inget om den här veckan" — en ensam löprunda hade annars
// öppnat en avstämning för en vecka utan ett enda styrkepass.
export async function genomfordaFor(datumLista) {
  const passIdn = new Set();
  for (const datum of datumLista) {
    for (const rad of await rowsForDatum(datum)) {
      if (!rad.status && rad.pass !== LOPPASS_ID) passIdn.add(rad.pass);
    }
  }
  return passIdn;
}

// Går den senaste veckogränsen att ångra, och vad skulle det i så fall röra?
//
// Två villkor. Fönstret är dagen gränsen sattes: `grans >= idag` täcker båda
// varianterna — en vecka som börjar i dag och en som börjar i morgon — och
// stänger dygnet efter, när gränsen är historia och inte längre ett feltryck.
// Dessutom får inga statusrader från den stängda veckan ha lämnat enheten:
// synkad JSONL är append-only. Backade vi gränsen efter det kunde passen tränas
// om, och veckan fick både en statusrad och loggade set för samma pass, vilket
// är precis vad datakontraktet förbjuder.
export async function angerbartAvslut(idag) {
  const starter = await veckostarter();
  const grans = starter[starter.length - 1];
  if (!grans || grans < idag) return null;

  const vecka = foregaendeVecka(veckaFor(grans, starter), starter);
  const rader = (await rowsForDatum(vecka.slut))
    .filter((r) => r.status && r.vecka === vecka.nyckel);
  if (rader.some((r) => r.synced)) return null;

  return { grans, vecka, rader };
}

// Tar tillbaka avslutet: statusraderna raderas, passen går tillbaka till
// markeringar, veckan öppnas för avstämning igen och gränsen tas bort.
//
// Veckans nyckel ändras inte av det här — gränsen som försvinner är NÄSTA
// veckas start, inte den här veckans — så bokföringen under `vecka:<nyckel>`
// förblir giltig. Det är vad som gör operationen säker att göra i flera steg.
export async function angraVeckoavslut(idag) {
  const info = await angerbartAvslut(idag);
  if (!info) return false;

  for (const rad of info.rader) await deleteSet(rad.localId);

  const passIdn = info.rader.map((r) => r.pass);
  const post = await hamtaVeckopost(info.vecka.nyckel);
  post.emitterade = post.emitterade.filter((id) => !passIdn.includes(id));
  post.markerade = [...new Set([...post.markerade, ...passIdn])];
  // Utan det här är en avvisad avstämning kvar som hanterad, och kortet kommer
  // aldrig tillbaka vid det naturliga veckoskiftet.
  post.hanterad = false;
  await sparaVeckopost(info.vecka.nyckel, post);

  await setSetting('veckostarter', (await veckostarter()).filter((s) => s !== info.grans));
  return true;
}

// Veckans state: vilken vecka vi är i, veckoraden och markeringarna. Delas av
// routeladdningen och av "Avsluta veckan" så de två aldrig kan räkna olika.
export async function veckoState(idag) {
  const starter = await veckostarter();
  const vecka = veckaFor(idag, starter);
  const veckoLogg = {};
  for (const datum of vecka.datumLista) {
    const rader = (await rowsForDatum(datum)).filter((r) => !r.status);
    veckoLogg[datum] = [...new Set(rader.map((r) => r.pass))];
  }
  return {
    starter,
    vecka,
    veckoLogg,
    veckoMarkeringar: await markeradeFor(vecka.nyckel),
    angerbart: (await angerbartAvslut(idag)) !== null,
  };
}

/* ---------- markera / ångra (pågående vecka) ---------- */

// Returnerar false om passet redan lämnat lager 1 — append-only gäller då.
export async function markera(vecka, passId) {
  const post = await hamtaVeckopost(vecka);
  if (post.emitterade.includes(passId)) return false;
  if (!post.markerade.includes(passId)) post.markerade.push(passId);
  await sparaVeckopost(vecka, post);
  return true;
}

export async function angraMarkering(vecka, passId) {
  const post = await hamtaVeckopost(vecka);
  if (post.emitterade.includes(passId)) return false;
  post.markerade = post.markerade.filter((id) => id !== passId);
  await sparaVeckopost(vecka, post);
  return true;
}

/* ---------- emittering (avslutad vecka) ---------- */

// En statusrad per pass i kön. sistaDatum = veckans söndag, alltid i det
// förflutna eftersom emittering bara sker efter veckoskiftet.
export async function emittera(vecka, sistaDatum, passIdn) {
  const post = await hamtaVeckopost(vecka);
  const nya = passIdn.filter((id) => !post.emitterade.includes(id));
  for (const passId of nya) {
    await addSet({
      datum: sistaDatum,
      pass: passId,
      status: 'ej_genomfort',
      vecka,
      ts: nuISO(),
      synced: 0,
      tsEpoch: Date.now(),
    });
    post.emitterade.push(passId);
    post.markerade = post.markerade.filter((id) => id !== passId);
  }
  await sparaVeckopost(vecka, post);
  return nya.length;
}

// Speglar statusrader som redan finns i loggen in i bokföringen. Används av
// återläsningen: utan detta ser avstämningen ett pass som redan HAR en
// statusrad i repot som ologgat, och erbjuder sig att skriva en till — en
// dubblett i en append-only-logg som inte går att ta bort.
export async function markeraEmitterade(vecka, passIdn) {
  const post = await hamtaVeckopost(vecka);
  post.emitterade = [...new Set([...post.emitterade, ...passIdn])];
  post.markerade = post.markerade.filter((id) => !post.emitterade.includes(id));
  await sparaVeckopost(vecka, post);
}

/* ---------- avstämning av föregående vecka ---------- */

// Körs vid varje laddning av startskärmen. Emitterar förra veckans manuella
// markeringar direkt (de var redan användarens beslut) och returnerar de
// ÖVRIGA ologgade passen för bekräftelse, eller null när inget behöver visas.
//
// Ett pass med loggade set emitteras aldrig — set vinner alltid över en
// markering, så motsägande rader kan inte uppstå.
export async function avstamningFor(program, vecka, datumLista) {
  const post = await hamtaVeckopost(vecka);
  if (post.hanterad) return null;

  const sistaDatum = datumLista[datumLista.length - 1];
  const genomforda = await genomfordaFor(datumLista);
  const alla = program.pass.map((p) => p.id);

  const attEmittera = post.markerade.filter((id) => !genomforda.has(id));
  if (attEmittera.length) await emittera(vecka, sistaDatum, attEmittera);

  const uppdaterad = await hamtaVeckopost(vecka);
  const saknade = alla.filter((id) => !genomforda.has(id) && !uppdaterad.emitterade.includes(id));

  // Ingen aktivitet alls den veckan: appen vet inget om den, luckan i loggen
  // talar för sig själv. Ingen ruta, inga rader — och veckan lämnas öppen så
  // en manuell markering fortfarande kan emitteras om den dyker upp.
  if (genomforda.size === 0 && uppdaterad.emitterade.length === 0) return null;

  if (saknade.length === 0) {
    await markeraHanterad(vecka);
    return null;
  }

  return {
    vecka,
    etikett: veckoEtikett(datumLista),
    sistaDatum,
    saknade,
    genomforda: genomforda.size,
    totalt: alla.length,
  };
}

export async function markeraHanterad(vecka) {
  const post = await hamtaVeckopost(vecka);
  post.hanterad = true;
  await sparaVeckopost(vecka, post);
}
