// Skärm 2: passvyn — det heliga loggflödet.
// Raderna är förifyllda (kaskad: tidigare set i sessionen → senaste historiska
// set → programmet), så ett oförändrat set loggas med ETT tryck på bocken.
// Ingen funktion i den här filen får addera tryck till den vägen.
//
// ⋮-menyn per övningskort rymmer det som inte hör till loggvägen: byta till en
// av coachens alternativa övningar (loggas som ovning=<alternativ> +
// alt_for=<original> enligt kontraktet).
//
// Set tas bort genom att svepa raden åt höger (papperskorgen bakom avslöjas).
// Synkad JSONL är append-only — synkade rader vägrar med förklaring.

import { getState, setState } from '../store.js';
import { addSet, updateSet, deleteSet, setSetting, lastSetFor, allaSetFor } from '../db.js';
import { formatVikt, parseVikt, parseHeltal, repsStart, todayISO, nuISO } from '../format.js';
import { arPB, pbLocalIds, rekordFor } from '../pb.js';
import { startaTimer, stangTimer } from '../timer.js';
import { synka, uppdateraBadge } from '../sync.js';
import { IKON } from '../ikoner.js';
import { el, esc, toast } from '../dom.js';

// Osparade ändringar i ologgade rader: "slotId:setNr:falt" → värde.
// Nyckeln är slotet, inte den aktiva övningen: två slot i samma pass kan köra
// samma övning, och då skulle redigeringar läcka mellan korten.
// Rensas när raden loggas, när slotet byter övning, eller när man byter pass.
const redigeringar = new Map();
let aktivtPassId = null;

export function render(state, rot) {
  const pass = state.program.pass.find((p) => p.id === state.route.passId);
  if (!pass) {
    location.hash = '#/';
    return;
  }
  if (aktivtPassId !== pass.id) {
    redigeringar.clear();
    aktivtPassId = pass.id;
  }

  const sektion = el(`
    <section class="passvy">
      <header class="passhuvud">
        <div class="passhuvud-topp">
          <button class="tillbaka" data-tillbaka>${IKON.tillbaka} Pass</button>
          <span style="flex:1"></span>
          <span id="sessionsklocka">--:--</span> ${IKON.klocka}
        </div>
        <div class="passhuvud-rad">
          <h1 class="display">${esc(pass.namn)}</h1>
          <button class="knapp primar" data-klar>Klar ${IKON.bock}</button>
        </div>
        <div class="progress">${pass.ovningar.map((o) => progressSegment(o, state)).join('')}</div>
      </header>
      ${pass.ovningar.map((o) => ovningskortHtml(o, state)).join('')}
      <label class="anteckning">
        <span>Anteckning (valfri)</span>
        <textarea id="anteckning" rows="3" placeholder="Hur kändes passet?">${esc(state.anteckningUtkast || '')}</textarea>
      </label>
    </section>`);

  kopplaHandelser(sektion, pass);
  rot.replaceChildren(sektion);

  if (state.ovningsMeny) {
    const slot = pass.ovningar.find((o) => o.id === state.ovningsMeny);
    if (slot) rot.append(menySheet(slot, state));
  }
}

/* ---------- markup ---------- */

// Namn för ett övnings-id, i tre steg: övningens egen definition → programmets
// `ovningsnamn`-katalog → id:t uppsnyggat.
//
// Katalogen finns för att de flesta alternativ-id:n aldrig får ett eget
// övningsobjekt (de är byten, inte slot). Utan den renderas de ur id:t, och
// fallbacken kan inte återskapa svenska tecken: `hangande_benlyft` blev
// "Hangande benlyft". Definitionen vinner över katalogen — annars kunde en
// katalogpost tyst döpa om en övning som redan har ett namn i sitt slot.
function namnForOvning(program, id) {
  for (const pass of program.pass) {
    const traff = pass.ovningar.find((o) => o.id === id);
    if (traff) return traff.namn;
  }
  const katalog = program.ovningsnamn?.[id];
  if (katalog) return katalog;
  const text = id.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function aktivtOvningsId(slot, state) {
  return state.byten[slot.id] || slot.id;
}

// Programmets mål som text: "Mål: 3 × 6-10 · 16 kg · RIR 2". Reps visas som rå
// programsträng ("8-12/ben", "30-60 sek" osv). Vid bytt övning eller vikt: null
// utelämnas viktdelen — programvikten gäller originalövningen.
function malText(o, bytt) {
  const delar = [`${o.set} × ${o.reps}`];
  if (!bytt && o.vikt !== null) delar.push(`${formatVikt(o.vikt)} kg`.replace('KV kg', 'KV'));
  delar.push(`RIR ${o.rir_mal}`);
  return `Mål: ${delar.join(' · ')}`;
}

// "PB: 35 kg × 11" — rekordet att slå, så att funktionen finns på kortet även
// när inget är loggat än. Stjärnan på setraden syns bara i det ögonblick man
// slår rekordet; utan det här chippet är PB osynligt fram till dess.
//
// Vikten är den NÄSTA SET faktiskt kommer använda (prefill-kaskaden), inte
// programmets målvikt — rekordet gäller per vikt, så det är den frågan som är
// relevant. Är vikten okalibrerad visas inget: då gäller Kalibrera-chippet.
function pbChipText(o, rader, aktivaRader, senast, bytt, state, aktivId) {
  let nr = 1;
  while (rader.some((r) => r.set === nr)) nr += 1;
  const { vikt } = prefill(o, nr, aktivaRader, senast, bytt);
  if (vikt === null || vikt === undefined) return null;

  const rekord = rekordFor(state.historikPerOvning[aktivId] || [], vikt, o.rir_mal);
  // "—" för "inget än", samma språk som "Senast: —" använder redan.
  return `PB: ${formatVikt(vikt)} kg × ${rekord || '—'}`.replace('KV kg', 'KV');
}

function progressSegment(o, state) {
  const loggade = raderFor(o.id, state).length;
  const andel = Math.min(1, loggade / o.set) * 100;
  return `<span class="progress-segment"><span style="width:${andel}%"></span></span>`;
}

function antalRaderFor(slot, rader, state) {
  const maxLoggat = Math.max(0, ...rader.map((r) => r.set));
  return Math.max(slot.set + (state.extraSet[slot.id] || 0), maxLoggat);
}

function ovningskortHtml(o, state) {
  const aktivId = aktivtOvningsId(o, state);
  const bytt = aktivId !== o.id;
  const namn = bytt ? namnForOvning(state.program, aktivId) : o.namn;
  const rader = raderFor(o.id, state);
  const aktivaRader = aktivaRaderFor(o.id, aktivId, state);
  const senast = state.senastePerOvning[aktivId];
  const senastText = senast
    ? `Senast: ${formatVikt(senast.vikt)} kg × ${senast.reps} × RIR ${senast.rir}`.replace('KV kg', 'KV')
    : 'Senast: —';
  const antalRader = antalRaderFor(o, rader, state);
  const behoverKalibrering = (bytt || o.vikt === null) && !senast && aktivaRader.length === 0;
  const pbIdn = pbIdnFor(rader, o, state);
  // Nyare program slår historiken i förifyllningen — och därmed även i PB-chippet,
  // så chip och rad alltid talar om samma vikt.
  const senastPrefill = senastForPrefill(state, senast, bytt);
  const pbText = pbChipText(o, rader, aktivaRader, senastPrefill, bytt, state, aktivId);

  let raderHtml = '';
  for (let nr = 1; nr <= antalRader; nr += 1) {
    const loggad = rader.find((r) => r.set === nr);
    raderHtml += loggad
      ? loggadRadHtml(loggad, pbIdn.has(loggad.localId))
      : ologgadRadHtml(o, nr, aktivaRader, senastPrefill, bytt);
  }

  return `
    <article class="kort ovningskort" data-ovning="${esc(o.id)}">
      <div class="ovning-topp">
        <h3 class="display">${esc(namn)}</h3>
        <button class="kebab" data-meny aria-label="Alternativ för ${esc(namn)}">${IKON.kebab}</button>
      </div>
      <div class="chip-rad">
        <span class="chip mal">${esc(malText(o, bytt))}</span>
        <span class="chip senast">${esc(senastText)}</span>
        ${pbText ? `<span class="chip pb">${esc(pbText)}</span>` : ''}
        ${bytt ? `<span class="chip">Ersätter ${esc(o.namn)}</span>` : ''}
        ${behoverKalibrering ? '<span class="chip kalibrera">Kalibrera — ange vikt</span>' : ''}
      </div>
      ${o.kommentar && !bytt ? `<p class="kommentar">${esc(o.kommentar)}</p>` : ''}
      <div class="settabell">
        <div class="settabell-huvud"><span>Set</span><span>Vikt</span><span>Reps</span><span>RIR</span><span></span></div>
        ${raderHtml}
      </div>
      <div class="ovning-knappar">
        <button class="knapp primar" data-vilotid>Vilotid ${IKON.klocka}</button>
        <button class="knapp primar" data-laggtill>Lägg till set ${IKON.plus}</button>
      </div>
    </article>`;
}

function loggadRadHtml(rad, arPBRad) {
  return `
    <div class="setrad loggad ${arPBRad ? 'pb' : ''}" data-set="${rad.set}" data-localid="${rad.localId}">
      <span class="setrad-radera" aria-hidden="true">${IKON.papperskorg}</span>
      <div class="setrad-varden">
        <span class="set-nr">${esc(rad.set)}${arPBRad ? `<span class="pb-markor" role="img" aria-label="Personbästa">${IKON.stjarna}</span>` : ''}</span>
        <button class="cell" data-falt="vikt">${esc(formatVikt(rad.vikt) || '—')}${rad.vikt ? ' kg' : ''}</button>
        <button class="cell" data-falt="reps">${esc(rad.reps)}</button>
        <button class="cell" data-falt="rir">${esc(rad.rir)}</button>
      </div>
      <button class="bock" data-loggad aria-label="Set ${rad.set} loggat">${IKON.bock}</button>
    </div>`;
}

function ologgadRadHtml(o, nr, rader, senast, bytt) {
  const v = prefill(o, nr, rader, senast, bytt);
  const viktSaknas = v.vikt === null || v.vikt === undefined;
  return `
    <div class="setrad" data-set="${nr}">
      <span class="setrad-radera" aria-hidden="true">${IKON.papperskorg}</span>
      <div class="setrad-varden">
        <span class="set-nr">${nr}</span>
        <button class="cell ${viktSaknas ? 'tom' : ''}" data-falt="vikt">${viktSaknas ? '—' : `${esc(formatVikt(v.vikt))}${v.vikt ? ' kg' : ''}`}</button>
        <button class="cell" data-falt="reps">${esc(v.reps)}</button>
        <button class="cell" data-falt="rir">${esc(v.rir)}</button>
      </div>
      <button class="bock" data-logga aria-label="Logga set ${nr}" ${viktSaknas ? 'disabled' : ''}>${IKON.bock}</button>
    </div>`;
}

function menySheet(slot, state) {
  const aktivId = aktivtOvningsId(slot, state);
  const bytt = aktivId !== slot.id;
  const alternativ = (slot.alternativ || []).filter((id) => id !== aktivId);

  const bytesval = [
    ...(bytt ? [`<button class="meny-val" data-byt="${esc(slot.id)}">${IKON.byt} Byt tillbaka till ${esc(slot.namn)}</button>`] : []),
    ...alternativ.map((id) => `<button class="meny-val" data-byt="${esc(id)}">${IKON.byt} ${esc(namnForOvning(state.program, id))}</button>`),
  ].join('');

  const wrapper = el(`
    <div class="meny-wrapper">
      <div class="installningar-backdrop" data-stang></div>
      <div class="installningar-sheet" role="dialog" aria-label="Alternativ för övningen">
        <h2 class="display">${esc(namnForOvning(state.program, aktivId))}</h2>
        ${bytesval ? `<p>Byt övning (coachens alternativ för samma muskler):</p><div class="meny-lista">${bytesval}</div>` : '<p>Inga alternativa övningar i programmet.</p>'}
      </div>
    </div>`);

  wrapper.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stang]')) {
      setState({ ovningsMeny: null });
      return;
    }
    const byt = e.target.closest('[data-byt]');
    if (byt) await bytOvning(slot, byt.dataset.byt);
  });

  return wrapper;
}

/* ---------- data ---------- */

// Vilket programslot en rad hör till: `alt_for` pekar ut slotet när övningen
// bytts, annars är övnings-id:t självt slotet. Att filtrera på `ovning` räcker
// inte — samma övning kan vara både eget slot och alternativ till ett annat slot
// i samma pass (benpress i lower1), och då skulle korten dela rader med varandra.
function slotForRad(rad) {
  return rad.alt_for || rad.ovning;
}

// Kortets rader: allt som loggats under slotet, oavsett vilken övning som kördes.
// Styr numrering och vad som ritas — annars tappas rader bort vid byte mitt i ett
// slot, och nästa set får ett setnummer som redan är använt.
function raderFor(slotId, state) {
  return state.sessionRader.filter((r) => slotForRad(r) === slotId);
}

// Prefill ska bara se set av den övning som faktiskt körs nu: byter man övning
// mitt i ett slot ärver det nya kortet inte den gamla övningens vikter.
function aktivaRaderFor(slotId, aktivId, state) {
  return raderFor(slotId, state).filter((r) => r.ovning === aktivId);
}

// Vilka av kortets rader som var PB. Ett slot kan rymma rader från flera övningar
// (byte mitt i passet), och PB räknas alltid mot den övning setet faktiskt
// gjordes i — därför en beräkning per övning. RIR-målet är slotets: en bytt
// övning ärver slotets mål, precis som set och reps.
function pbIdnFor(rader, slot, state) {
  const traffar = new Set();
  for (const ovningId of new Set(rader.map((r) => r.ovning))) {
    for (const id of pbLocalIds(state.historikPerOvning[ovningId] || [], slot.rir_mal)) {
      traffar.add(id);
    }
  }
  return traffar;
}

// state.historikPerOvning speglar sets-storen för de övningar passet visar, och
// PB räknas ur den. Varje ändring av en loggad rad måste därför speglas hit,
// annars sitter stjärnan kvar på fel rad tills vyn laddas om.
function speglaIHistorik(historik, ovningId, andring) {
  if (!ovningId) return historik;
  return { ...historik, [ovningId]: andring(historik[ovningId] || []) };
}

// Har coachen uppdaterat programmet EFTER övningens senaste loggade set ska
// hennes nya siffror förifyllas, inte historiken. Utan detta landar aldrig en
// kalibrering: "Mål:" visar 70 kg medan raden föreslår 60, och ett tryck på
// bocken loggar den gamla vikten. Värst åt andra hållet — coachen sänkte RDL
// 60 → 55 just för att 60 gav RIR 0, och appen hade fortsatt föreslå 60.
//
// Så fort passet är loggat på den nya vikten är loggen färskast igen och tar
// över. Samma datum räknas som "redan tränat på det nya" ⇒ loggen vinner.
//
// Returnerar det `senast` som prefill ska se. Att nolla den räcker: kaskaden
// faller då igenom till programmet, vilket är precis vad vi vill. Visningen av
// "Senast:" använder den riktiga raden — hon ska fortfarande se vad hon gjorde.
//
// Bytt övning undantas: programmets vikt gäller originalövningen, så där är
// historiken den enda vettiga källan oavsett datum.
function senastForPrefill(state, senast, bytt) {
  if (bytt || !senast?.datum) return senast;
  const { uppdaterad } = state.program;
  return uppdaterad && uppdaterad > senast.datum ? null : senast;
}

// Förifyllnadskaskad: tidigare set i sessionen → senaste historiska set → programmet.
// Bytt övning saknar viktförslag från programmet (vikten gäller originalet) → kalibrera.
// Osparade cellredigeringar läggs ovanpå — nycklade på slot, se redigeringar-kommentaren.
function prefill(o, nr, rader, senast, bytt) {
  const sista = rader[rader.length - 1] || null;
  const bas = {
    vikt: sista ? sista.vikt : senast ? senast.vikt : bytt ? null : o.vikt,
    reps: sista ? sista.reps : senast ? senast.reps : repsStart(o.reps),
    rir: sista ? sista.rir : senast ? senast.rir : o.rir_mal,
  };
  for (const falt of ['vikt', 'reps', 'rir']) {
    const nyckel = `${o.id}:${nr}:${falt}`;
    if (redigeringar.has(nyckel)) bas[falt] = redigeringar.get(nyckel);
  }
  return bas;
}

function sessionsDatum(state) {
  return state.sessionRader[0]?.datum || todayISO();
}

/* ---------- händelser ---------- */

function kopplaHandelser(sektion, pass) {
  kopplaSvep(sektion, pass);

  sektion.addEventListener('click', (e) => {
    if (Date.now() < ignoreraKlickTills) return; // släpp efter svep är inget tryck
    const state = getState();

    if (e.target.closest('[data-tillbaka]')) {
      location.hash = '#/';
      return;
    }
    if (e.target.closest('[data-klar]')) {
      klarPass(pass, sektion);
      return;
    }

    const kort = e.target.closest('[data-ovning]');
    if (!kort) return;
    const ovning = pass.ovningar.find((o) => o.id === kort.dataset.ovning);

    if (e.target.closest('[data-meny]')) {
      setState({ ovningsMeny: ovning.id });
      return;
    }
    if (e.target.closest('[data-vilotid]')) {
      const aktivId = aktivtOvningsId(ovning, state);
      startaTimer(ovning.vila_sek, namnForOvning(state.program, aktivId), true); // öppna direkt i redigeringsläge
      return;
    }
    if (e.target.closest('[data-laggtill]')) {
      const antal = antalRaderFor(ovning, raderFor(ovning.id, state), state);
      setState({ extraSet: { ...state.extraSet, [ovning.id]: antal + 1 - ovning.set } });
      return;
    }

    const rad = e.target.closest('.setrad');
    if (!rad) return;

    if (e.target.closest('[data-logga]')) {
      loggaSet(ovning, rad, pass);
      return;
    }
    const cell = e.target.closest('.cell');
    if (cell) borjaRedigera(cell, rad, ovning);
  });

  // Anteckningsutkastet sparas löpande — utan omrendering, så fokus behålls.
  const anteckning = sektion.querySelector('#anteckning');
  let utkastTimer = null;
  anteckning.addEventListener('input', () => {
    const state = getState();
    state.anteckningUtkast = anteckning.value;
    clearTimeout(utkastTimer);
    utkastTimer = setTimeout(() => {
      setSetting(`utkast:${sessionsDatum(state)}:${pass.id}`, anteckning.value);
    }, 400);
  });
}

// Ett tryck på bocken = setet loggat med radens nuvarande värden.
async function loggaSet(ovning, radEl, pass) {
  const state = getState();
  const aktivId = aktivtOvningsId(ovning, state);
  const bytt = aktivId !== ovning.id;
  const nr = Number(radEl.dataset.set);
  const varden = prefill(
    ovning,
    nr,
    aktivaRaderFor(ovning.id, aktivId, state),
    senastForPrefill(state, state.senastePerOvning[aktivId], bytt),
    bytt,
  );
  if (varden.vikt === null || varden.vikt === undefined) return; // kalibrering krävs först

  const rad = {
    datum: sessionsDatum(state), // månadsskifte mid-pass: hela passet följer första setets datum
    pass: pass.id,
    ovning: aktivId,
    set: nr,
    vikt: varden.vikt,
    reps: varden.reps,
    rir: varden.rir,
    ts: nuISO(),
    synced: 0,
    tsEpoch: Date.now(),
  };
  if (bytt) rad.alt_for = ovning.id;
  rad.localId = await addSet(rad);

  // PB avgörs mot historiken som den såg ut FÖRE det här setet — annars jämförs
  // setet med sig självt och blir aldrig ett rekord.
  const historik = state.historikPerOvning[aktivId] || [];
  const nyttPB = arPB(rad, historik, ovning.rir_mal);

  // Sessionen är öppen (igen) tills KLAR trycks — håller raderna borta från synk.
  await setSetting(`session:${rad.datum}:${pass.id}`, { klar: false });

  ['vikt', 'reps', 'rir'].forEach((f) => redigeringar.delete(`${ovning.id}:${nr}:${f}`));
  startaTimer(ovning.vila_sek, namnForOvning(state.program, aktivId), false);
  setState({
    sessionRader: [...state.sessionRader, rad],
    historikPerOvning: { ...state.historikPerOvning, [aktivId]: [...historik, rad] },
  });

  // Toasten ligger över timer-sheeten (z-index 90 mot 50), som öppnas i samma
  // ögonblick. Utan den vore stjärnan på raden dold när den betyder som mest.
  if (nyttPB) toast(`PB · ${formatVikt(rad.vikt)} kg × ${rad.reps}`.replace('KV kg', 'KV'));
  uppdateraBadge();
}

// Byt övning för dagens session (eller tillbaka). Persisteras så reload mid-pass funkar.
async function bytOvning(slot, nyttId) {
  const state = getState();
  const byten = { ...state.byten };
  if (nyttId === slot.id) delete byten[slot.id];
  else byten[slot.id] = nyttId;
  await setSetting(`byte:${sessionsDatum(state)}:${state.route.passId}`, byten);

  // Osparade redigeringar gällde den gamla övningens vikter — de ska inte
  // följa med in i den nya. Nycklarna är slot-prefixade, så slotet städas rent.
  for (const nyckel of [...redigeringar.keys()]) {
    if (nyckel.startsWith(`${slot.id}:`)) redigeringar.delete(nyckel);
  }

  // "Senast:" byggs per aktiv övning vid routeladdning — hämta den nya
  // övningens historik här, annars kräver kortet falsk kalibrering.
  const senastePerOvning = { ...state.senastePerOvning };
  senastePerOvning[nyttId] = await lastSetFor(nyttId, todayISO());

  // Samma sak för PB-underlaget. Den gamla övningens historik lämnas kvar:
  // dagens rader kan höra till den, och de ska behålla sina stjärnor.
  const historikPerOvning = { ...state.historikPerOvning };
  if (!historikPerOvning[nyttId]) historikPerOvning[nyttId] = await allaSetFor(nyttId);

  setState({
    byten, senastePerOvning, historikPerOvning, ovningsMeny: null,
  });
}

/* ---------- svep: dra en rad åt höger → ta bort setet ---------- */

// Klick strax efter ett svep ignoreras — annars tolkas släppet som ett tryck
// på cellen/bocken under fingret.
let ignoreraKlickTills = 0;

// Vad ett högersvep får göra med raden:
//   'loggad'        — osynkat loggat set: raderas ur IndexedDB
//   'sista-ologgad' — sista raden, ologgad: tas bort ur tabellen (extraSet--,
//                     kan bli negativt = färre rader än programmet; endast UI-state)
//   'synkad'        — synkad JSONL är append-only: vägra med förklaring
//   'nej'           — ologgad rad mitt i tabellen, eller sista kvarvarande raden
function raderbarhet(radEl, ovning) {
  const state = getState();
  const localId = radEl.dataset.localid ? Number(radEl.dataset.localid) : null;
  if (localId) {
    return state.sessionRader.find((r) => r.localId === localId)?.synced === 1 ? 'synkad' : 'loggad';
  }
  const nr = Number(radEl.dataset.set);
  const antal = antalRaderFor(ovning, raderFor(ovning.id, state), state);
  return nr === antal && antal > 1 ? 'sista-ologgad' : 'nej';
}

async function taBortRad(radEl, ovning) {
  const state = getState();
  const localId = radEl.dataset.localid ? Number(radEl.dataset.localid) : null;
  if (localId) {
    const borttagen = state.sessionRader.find((r) => r.localId === localId);
    await deleteSet(localId);
    setState({
      sessionRader: state.sessionRader.filter((r) => r.localId !== localId),
      historikPerOvning: speglaIHistorik(
        state.historikPerOvning,
        borttagen?.ovning,
        (rader) => rader.filter((r) => r.localId !== localId),
      ),
    });
    uppdateraBadge();
  } else {
    setState({ extraSet: { ...state.extraSet, [ovning.id]: (state.extraSet[ovning.id] || 0) - 1 } });
  }
}

// Pointer events: aktiveras först när draget är tydligt horisontellt åt höger
// (vertikala drag lämnas åt scrollen via touch-action: pan-y). Rader som inte
// får raderas följer med en bit med motstånd och fjädrar tillbaka.
function kopplaSvep(sektion, pass) {
  let svep = null;

  sektion.addEventListener('pointerdown', (e) => {
    const radEl = e.target.closest('.setrad');
    if (!radEl || e.target.closest('.cell-input, .cell-minus')) return;
    const kort = e.target.closest('[data-ovning]');
    const ovning = pass.ovningar.find((o) => o.id === kort.dataset.ovning);
    svep = {
      radEl,
      varden: radEl.querySelector('.setrad-varden'),
      ovning,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      aktiv: false,
      dx: 0,
    };
  });

  sektion.addEventListener('pointermove', (e) => {
    if (!svep || e.pointerId !== svep.pointerId) return;
    const dx = e.clientX - svep.startX;
    const dy = e.clientY - svep.startY;
    if (!svep.aktiv) {
      if (dx < 12 || Math.abs(dy) > Math.abs(dx)) return;
      svep.aktiv = true;
      svep.status = raderbarhet(svep.radEl, svep.ovning);
      svep.troskel = Math.max(80, svep.varden.getBoundingClientRect().width * 0.35);
      svep.radEl.classList.add('sveps');
      svep.radEl.setPointerCapture(e.pointerId);
    }
    svep.dx = Math.max(0, dx);
    const raderbar = svep.status === 'loggad' || svep.status === 'sista-ologgad';
    const x = raderbar ? svep.dx : Math.min(40, svep.dx * 0.25);
    svep.varden.style.transform = `translateX(${x}px)`;
    svep.radEl.classList.toggle('svep-klar', raderbar && svep.dx > svep.troskel);
  });

  async function slappSvep(e) {
    if (!svep || e.pointerId !== svep.pointerId) return;
    const s = svep;
    svep = null;
    if (!s.aktiv) return;
    ignoreraKlickTills = Date.now() + 400;

    const raderbar = s.status === 'loggad' || s.status === 'sista-ologgad';
    if (raderbar && s.dx > s.troskel && e.type === 'pointerup') {
      s.varden.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
      s.varden.style.transform = 'translateX(110%)';
      s.varden.style.opacity = '0';
      await new Promise((klar) => setTimeout(klar, 150));
      await taBortRad(s.radEl, s.ovning); // setState ritar om vyn — DOM:en ersätts
      return;
    }

    if (s.status === 'synkad' && s.dx > 30) toast('Setet är synkat och kan inte tas bort');
    s.varden.style.transition = 'transform 0.18s ease-out';
    s.varden.style.transform = '';
    s.radEl.classList.remove('sveps', 'svep-klar');
    setTimeout(() => { s.varden.style.transition = ''; }, 200);
  }

  sektion.addEventListener('pointerup', slappSvep);
  sektion.addEventListener('pointercancel', slappSvep);
}

// Tryck på en cell → numerisk input. Ologgad rad: värdet sparas som redigering.
// Loggad rad: värdet skrivs direkt till IndexedDB (raden är osynkad tills KLAR).
// Redan synkade rader är oföränderliga — append-only-JSONL skrivs aldrig om.
function borjaRedigera(cell, radEl, ovning) {
  const falt = cell.dataset.falt;
  const nr = Number(radEl.dataset.set);
  const localId = radEl.dataset.localid ? Number(radEl.dataset.localid) : null;
  const state = getState();
  const aktivId = aktivtOvningsId(ovning, state);
  const bytt = aktivId !== ovning.id;

  if (localId && state.sessionRader.find((r) => r.localId === localId)?.synced === 1) {
    toast('Setet är synkat och kan inte ändras');
    return;
  }

  let varde;
  if (localId) {
    varde = state.sessionRader.find((r) => r.localId === localId)?.[falt];
  } else {
    varde = prefill(
      ovning,
      nr,
      aktivaRaderFor(ovning.id, aktivId, state),
      senastForPrefill(state, state.senastePerOvning[aktivId], bytt),
      bytt,
    )[falt];
  }

  const input = el(`<input class="cell-input" inputmode="${falt === 'vikt' ? 'decimal' : 'numeric'}" enterkeyhint="done" aria-label="${falt}">`);
  input.value = varde === null || varde === undefined ? '' : String(varde).replace('.', ',');
  cell.replaceWith(input);
  input.focus();
  input.select();

  // Negativ vikt = assisterande vikt (se parseVikt). iPhonens siffertangentbord
  // saknar minustecken, så tecknet vänds med en knapp i stället. Den läggs över
  // setnumret — 44 × 44 px som redan är "upptagna" av något utan funktion — och
  // finns bara medan viktcellen redigeras, så loggvägen får inga extra tryck.
  // pointerdown + preventDefault: inputen får inte tappa fokus (blur = spara).
  if (falt === 'vikt') {
    const minus = el('<button class="cell-minus" aria-label="Växla assisterande vikt (minus)">±</button>');
    minus.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const t = input.value.trim();
      input.value = t.startsWith('-') ? t.slice(1) : `-${t}`;
    });
    radEl.querySelector('.setrad-varden').append(minus);
    // Städas aldrig manuellt: bekrafta kör alltid setState, som ritar om vyn.
  }

  let klarKord = false;
  const bekrafta = async () => {
    if (klarKord) return;
    klarKord = true;
    const text = input.value;
    const nytt = falt === 'vikt' ? parseVikt(text) : parseHeltal(text);

    if (localId) {
      if (nytt !== null) {
        await updateSet(localId, { [falt]: nytt });
        const nu = getState();
        const rader = nu.sessionRader.map((r) => (r.localId === localId ? { ...r, [falt]: nytt } : r));
        // En rättad siffra kan göra raden till PB, eller ta ifrån den stjärnan.
        // Historiken speglas därför här, och markeringarna räknas om vid render.
        setState({
          sessionRader: rader,
          historikPerOvning: speglaIHistorik(
            nu.historikPerOvning,
            nu.sessionRader.find((r) => r.localId === localId)?.ovning,
            (h) => h.map((r) => (r.localId === localId ? { ...r, [falt]: nytt } : r)),
          ),
        });
        return;
      }
    } else if (nytt !== null) {
      redigeringar.set(`${ovning.id}:${nr}:${falt}`, nytt);
    }
    setState({}); // rita om vyn med (eventuellt oförändrade) värden
  };

  input.addEventListener('blur', bekrafta);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
}

// KLAR: fäst anteckningen på sessionens sista rad, stäng sessionen, synka.
async function klarPass(pass, sektion) {
  const state = getState();
  const rader = state.sessionRader;
  const utkast = sektion.querySelector('#anteckning').value.trim();

  if (rader.length > 0) {
    const datum = rader[0].datum;
    if (utkast) {
      const sista = rader[rader.length - 1];
      await updateSet(sista.localId, { anteckning: utkast });
    }
    await setSetting(`session:${datum}:${pass.id}`, { klar: true });
    await setSetting(`utkast:${datum}:${pass.id}`, null);
  }

  stangTimer();
  setState({ anteckningUtkast: '', extraSet: {}, ovningsMeny: null });
  location.hash = '#/';
  synka();
}
