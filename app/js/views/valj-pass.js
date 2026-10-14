// Skärm 1: "Välj pass" — veckorad, passkort, diskret synkrad.
// Veckoradens markeringar härleds ur loggen: orange = dag med loggat pass
// (passnamnet under), grönt = idag. Ingen schemavy — programmet har ingen
// veckodagsplan (passen körs i rullande ordning).
//
// Passkortets status gäller INNEVARANDE VECKA och härleds i den här ordningen:
// loggat set (Klar) → markerat "ej genomfört" → inget. Set vinner alltid, så
// ⋮-menyn försvinner så fort passet har ett loggat set. Logiken för själva
// markeringen bor i veckostatus.js.

import { setState, getState } from '../store.js';
import {
  veckodagsBokstav, veckaFor, foregaendeVecka, todayISO, uppskattadMin, veckoRubrik, veckoEtikett,
  nastaVeckostart, nuISO, LOPPASS_ID,
} from '../format.js';
import { IKON } from '../ikoner.js';
import { el, esc, toast } from '../dom.js';
import { addSet } from '../db.js';
import {
  getToken, setToken, getRepoKonfig, setRepoKonfig, synka, uppdateraBadge, harSynkKonfig,
} from '../sync.js';
import { aterlas, aterlasVidBehov } from '../aterlasning.js';
import { AR_DEMO } from '../lage.js';
import { borjaOmDemo } from '../demo.js';
import { begarNotisTillstand } from '../timer.js';
import {
  markera, angraMarkering, markeradeFor, emittera, markeraHanterad,
  borjaNyVecka, angraVeckoavslut, avstamningFor, veckoState, veckostarter,
} from '../veckostatus.js';

export function render(state, rot) {
  const {
    program, veckoLogg, osynkade, synkStatus, installningarOppna, veckoAvstamning, passMeny,
    programVarning, avslutaOppen, angerbart, loppassOppet,
  } = state;
  const idag = todayISO();
  // Veckan kommer från routeladdningen; fallbacken gäller bara den korta stunden
  // före första laddningen och ger då den vanliga kalenderveckan.
  const vecka = state.vecka || veckaFor(idag);
  const dagar = vecka.datumLista;

  const sektion = el(`
    <section class="valj-pass">
      <h1 class="display">Välj pass</h1>
      ${AR_DEMO ? '<p class="demorad">Demo med påhittad data. Det du loggar sparas bara i den här webbläsaren.</p>' : ''}
      ${programVarning ? programvarningskortHtml(programVarning) : ''}
      ${veckoAvstamning ? avstamningskortHtml(veckoAvstamning, program) : ''}
      <h2 class="veckan-rubrik display">Veckan</h2>
      <div class="veckorad" style="--veckodagar: ${dagar.length}">
        ${dagar.map((datum) => veckodagHtml(datum, veckoLogg, idag, program)).join('')}
      </div>
      <p class="veckosummering">${esc(veckosummering(state))}</p>
      ${veckoknappHtml(angerbart)}
      <div class="passlista">
        ${program.pass.map((pass) => passkortHtml(pass, state)).join('')}
        ${program.lopning ? lopkortHtml(state) : ''}
      </div>
      <footer class="synkrad">
        <span class="synk-badge ${osynkade && !AR_DEMO ? 'har-osynkat' : ''}">${synkText(osynkade, synkStatus)}</span>
        <button class="knapp-diskret" data-installningar>${IKON.reglage} Inställningar</button>
      </footer>
    </section>`);

  sektion.addEventListener('click', (e) => {
    const starta = e.target.closest('[data-starta]');
    if (starta) {
      location.hash = `#/pass/${starta.dataset.starta}`;
      return;
    }
    const meny = e.target.closest('[data-meny]');
    if (meny) {
      setState({ passMeny: meny.dataset.meny });
      return;
    }
    if (e.target.closest('[data-bekrafta]')) {
      bekraftaAvstamning(veckoAvstamning, program, true);
      return;
    }
    if (e.target.closest('[data-avvisa]')) {
      bekraftaAvstamning(veckoAvstamning, program, false);
      return;
    }
    // Omladdning i stället för att köra om delar av booten — samma val som
    // felruta() gör i main.js: hela startsekvensen körs om i rätt ordning.
    if (e.target.closest('[data-ladda-om]')) {
      location.reload();
      return;
    }
    if (e.target.closest('[data-ny-vecka]')) {
      setState({ avslutaOppen: true });
      return;
    }
    // Ingen bekräftelse på ångra: den ÄR återställningen av en bekräftad
    // handling, och en ruta framför den hade bara gjort vägen ut längre.
    if (e.target.closest('[data-angra-avslut]')) {
      angraAvslutet();
      return;
    }
    if (e.target.closest('[data-loppass]')) {
      setState({ loppassOppet: true });
      return;
    }
    if (e.target.closest('[data-installningar]')) setState({ installningarOppna: true });
  });

  rot.replaceChildren(sektion);
  if (installningarOppna) rot.append(installningarSheet());
  if (avslutaOppen) rot.append(avslutaVeckaSheet(program, veckoLogg));
  if (loppassOppet) rot.append(loppassSheet(program));
  if (passMeny) {
    const pass = program.pass.find((p) => p.id === passMeny);
    if (pass) rot.append(passMenySheet(pass, state, vecka));
  }
}

/* ---------- avsluta veckan ---------- */

// Har en gräns nyss satts är ångra det enda vettiga valet; annars går det alltid
// att starta en ny vecka. Exakt en knapp visas, aldrig två.
//
// Knappen gömdes tidigare när veckan slutade i dag, med motiveringen att den då
// tar slut ändå. Det var fel: söndagen är just den dag man behöver flytta
// gränsen, för annars hamnar söndagens pass i veckan som redan är fylld.
function veckoknappHtml(angerbart) {
  if (angerbart) {
    return '<button class="knapp-diskret avsluta-vecka" data-angra-avslut>Ångra</button>';
  }
  return '<button class="knapp-diskret avsluta-vecka" data-ny-vecka>Börja ny vecka</button>';
}

async function angraAvslutet() {
  const idag = todayISO();
  if (!(await angraVeckoavslut(idag))) {
    toast('Veckan är avstämd och skickad till loggen');
    return;
  }
  const { vecka, veckoLogg, veckoMarkeringar, angerbart } = await veckoState(idag);
  setState({ vecka, veckoLogg, veckoMarkeringar, angerbart, veckoAvstamning: null });
  await uppdateraBadge();
  toast('Avslutet är ångrat');
}

// Veckan slutar i dag och nästa börjar i morgon. Gränsen går inte att ångra i
// UI:t, så tryckningen bekräftas — och texten säger exakt vilket spann den nya
// veckan får, eftersom den kan bli längre än sju dagar när den snäpper tillbaka
// till kalendern.
function avslutaVeckaSheet(program, veckoLogg) {
  const idag = todayISO();
  const imorgon = nastaVeckostart(idag);
  const tranatIDag = (veckoLogg[idag] || []).length > 0;

  // Två sätt att dra gränsen, och de behövs båda. "I dag" när man står på
  // morgonen och nästa pass ska inleda den nya veckan; "i morgon" när man
  // avslutar på kvällen och dagens pass hör till veckan som varit.
  const val = [
    { start: idag, etikett: 'i dag' },
    { start: imorgon, etikett: 'i morgon' },
  ].map((v) => {
    const nya = veckaFor(v.start, [v.start]);
    const gamla = foregaendeVecka(nya, [v.start]);
    return { ...v, nya, gamla };
  });

  const valHtml = val.map((v) => `
    <button class="meny-val" data-start="${v.start}">
      Börja ${v.etikett} — ${esc(veckoEtikett(v.nya.datumLista))}, ${v.nya.datumLista.length} dagar
      <small>${esc(veckoRubrik(v.gamla.nyckel, v.gamla.etikett))} stängs</small>
    </button>`).join('');

  const wrapper = el(`
    <div class="meny-wrapper">
      <div class="installningar-backdrop" data-stang></div>
      <div class="installningar-sheet" role="dialog" aria-label="Börja ny vecka">
        <h2 class="display">Börja ny vecka</h2>
        <p>När ska den nya veckan börja?</p>
        <div class="meny-lista">${valHtml}</div>
        ${tranatIDag ? '<p>Du har loggat pass i dag. Väljer du "i dag" flyttas de till den nya veckan.</p>' : ''}
        <p>Pass du markerat som ej genomförda skrivs till loggen nu i stället för vid veckoskiftet.
           Du kan ångra i dag — men inte efter att de raderna har synkats.</p>
      </div>
    </div>`);

  wrapper.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stang]')) {
      setState({ avslutaOppen: false });
      return;
    }
    const valt = e.target.closest('[data-start]');
    if (!valt) return;

    await borjaNyVecka(valt.dataset.start);
    const { vecka, veckoLogg: nyLogg, veckoMarkeringar, angerbart } = await veckoState(idag);
    // Avstämningen gäller veckan som just stängdes. Är den nya veckan den som
    // innehåller i dag ligger den stängda bakom oss — annars är det veckan vi
    // fortfarande står i som stängts.
    const stangd = vecka.start === valt.dataset.start ? foregaendeVecka(vecka, await veckostarter()) : vecka;
    const avstamning = await avstamningFor(program, stangd.nyckel, stangd.datumLista);
    setState({
      vecka, veckoLogg: nyLogg, veckoMarkeringar, angerbart,
      veckoAvstamning: avstamning, avslutaOppen: false,
    });
    if (!avstamning) toast(`Ny vecka: ${veckoEtikett(vecka.datumLista)}`);
  });

  return wrapper;
}

/* ---------- veckostatus ---------- */

function genomfortDennaVecka(passId, veckoLogg) {
  return Object.values(veckoLogg).some((passIdn) => passIdn.includes(passId));
}

function veckosummering(state) {
  const totalt = state.program.pass.length;
  const klara = state.program.pass.filter((p) => genomfortDennaVecka(p.id, state.veckoLogg)).length;
  const ejGenomforda = state.veckoMarkeringar.filter(
    (id) => !genomfortDennaVecka(id, state.veckoLogg),
  ).length;
  const lop = loppassDennaVecka(state.veckoLogg);
  const delar = [`${klara} av ${totalt} pass`];
  if (lop) delar.push(`${lop} ${lop === 1 ? 'löppass' : 'löpdagar'}`);
  if (ejGenomforda) delar.push(`${ejGenomforda} ${ejGenomforda === 1 ? 'ej genomfört' : 'ej genomförda'}`);
  return delar.join(' · ');
}

function passNamn(program, id) {
  if (id === LOPPASS_ID) return 'Löpning';
  return program.pass.find((p) => p.id === id)?.namn || id;
}

// "Lower 2", "Lower 2 och Upper 2", "Upper 1, Lower 2 och Upper 2"
function listaNamn(ids, program) {
  const namn = ids.map((id) => passNamn(program, id));
  if (namn.length <= 1) return namn.join('');
  return `${namn.slice(0, -1).join(', ')} och ${namn[namn.length - 1]}`;
}

function veckodagHtml(datum, veckoLogg, idag, program) {
  const passIdn = veckoLogg[datum] || [];
  const namn = passIdn.map((id) => passNamn(program, id)).join(', ');
  const klasser = ['veckodag'];
  if (passIdn.length) klasser.push('har-pass');
  if (datum === idag) klasser.push('idag');
  return `
    <div class="${klasser.join(' ')}">
      <span class="veckodag-cirkel">${veckodagsBokstav(datum)}</span>
      <span class="veckodag-pass">${esc(namn)}</span>
    </div>`;
}

function passkortHtml(pass, state) {
  const klar = genomfortDennaVecka(pass.id, state.veckoLogg);
  const ejGenomfort = !klar && state.veckoMarkeringar.includes(pass.id);

  let chip = `<span class="chip">Styrka ${IKON.hantel}</span>`;
  if (klar) chip = `<span class="chip status klar">Klar ${IKON.bock}</span>`;
  else if (ejGenomfort) chip = `<span class="chip status ej">Ej genomfört ${IKON.ejGenomfort}</span>`;

  return `
    <article class="kort passkort ${ejGenomfort ? 'ej-genomfort' : ''}">
      <div class="passkort-topp">
        ${chip}
        <span class="passkort-tid">${uppskattadMin(pass)} min ${IKON.klocka}</span>
        ${klar ? '' : `<button class="kebab" data-meny="${esc(pass.id)}" aria-label="Alternativ för ${esc(pass.namn)}">${IKON.kebab}</button>`}
      </div>
      <div class="passkort-botten">
        <h3 class="display">${esc(pass.namn)}</h3>
        <button class="knapp primar" data-starta="${esc(pass.id)}">Starta ${IKON.spela}</button>
      </div>
    </article>`;
}

/* ---------- löpning ---------- */

// Antal DAGAR med ett registrerat löppass den här veckan. Två rundor samma dag
// räknas som en — veckoLogg bokför per datum, och för uppföljningen mot
// programmets pass_per_vecka är dagen det som betyder något.
function loppassDennaVecka(veckoLogg) {
  return Object.values(veckoLogg).filter((ids) => ids.includes(LOPPASS_ID)).length;
}

// Löpningen ligger som ett kort i passlistan, inte i en meny: den glömdes bort
// helt så länge den bara fanns i programfilen, och ett kort bland de andra är
// det enda stället man faktiskt tittar. Kortet har ingen passvy bakom sig —
// löpning har inga övningar — så knappen öppnar en sheet i stället för en route.
function lopkortHtml(state) {
  const antal = loppassDennaVecka(state.veckoLogg);
  const planerat = state.program.lopning?.pass_per_vecka ?? 0;
  const chip = antal
    ? `<span class="chip status klar">${antal} denna vecka ${IKON.bock}</span>`
    : `<span class="chip">Löpning ${IKON.lopning}</span>`;

  return `
    <article class="kort passkort lopkort">
      <div class="passkort-topp">
        ${chip}
        ${planerat ? `<span class="passkort-tid">${planerat}/vecka</span>` : ''}
      </div>
      <div class="passkort-botten">
        <h3 class="display">Löppass</h3>
        <button class="knapp primar" data-loppass>Registrera ${IKON.plus}</button>
      </div>
    </article>`;
}

// Tomt fält → undefined (fältet utelämnas ur raden), ogiltigt → NaN.
// Komma accepteras: svenska tangentbord ger komma som decimaltecken.
function tolkaTal(text) {
  const rent = String(text).trim().replace(',', '.');
  if (!rent) return undefined;
  const n = Number(rent);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function lopSammanfattning(distans, tid) {
  const delar = [];
  if (distans !== undefined) delar.push(`${String(distans).replace('.', ',')} km`);
  if (tid !== undefined) delar.push(`${tid} min`);
  return delar.join(' / ');
}

// Registreringen av ett löppass. Två dagval i stället för en datumväljare:
// kvällslöpningen registreras ofta dagen efter, och längre bak än så har
// siffrorna ändå hunnit bli gissningar.
//
// Fälten är type="text" med inputmode, inte type="number": ett komma i ett
// sifferfält ger tom value i flera webbläsare, och komma är vad tangentbordet
// erbjuder här.
function loppassSheet(program) {
  const idag = todayISO();
  const igarDatum = new Date();
  igarDatum.setDate(igarDatum.getDate() - 1); // setDate klarar månads- och DST-skiften
  const igar = todayISO(igarDatum);
  const planerat = program.lopning?.pass_per_vecka ?? 0;

  const wrapper = el(`
    <div class="meny-wrapper">
      <div class="installningar-backdrop" data-stang></div>
      <div class="installningar-sheet" role="dialog" aria-label="Registrera löppass">
        <h2 class="display">Löppass</h2>
        ${planerat ? `<p>${esc(program.lopning.beskrivning || '')}</p>` : ''}
        <div class="lop-dagar" role="group" aria-label="Vilken dag">
          <button class="meny-val vald" data-dag="${idag}" aria-pressed="true">I dag</button>
          <button class="meny-val" data-dag="${igar}" aria-pressed="false">I går</button>
        </div>
        <div class="lop-falt">
          <label>Distans (km)
            <input type="text" inputmode="decimal" autocomplete="off" placeholder="4,2" data-distans>
          </label>
          <label>Tid (min)
            <input type="text" inputmode="numeric" autocomplete="off" placeholder="28" data-tid>
          </label>
        </div>
        <button class="knapp primar" data-spara>Spara ${IKON.bock}</button>
        <p>Fyll i det du har — ett av fälten räcker.</p>
      </div>
    </div>`);

  let datum = idag;

  wrapper.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stang]')) {
      setState({ loppassOppet: false });
      return;
    }
    const dag = e.target.closest('[data-dag]');
    if (dag) {
      datum = dag.dataset.dag;
      wrapper.querySelectorAll('[data-dag]').forEach((knapp) => {
        const vald = knapp === dag;
        knapp.classList.toggle('vald', vald);
        knapp.setAttribute('aria-pressed', String(vald));
      });
      return;
    }
    if (!e.target.closest('[data-spara]')) return;

    const distans = tolkaTal(wrapper.querySelector('[data-distans]').value);
    const tid = tolkaTal(wrapper.querySelector('[data-tid]').value);
    if (Number.isNaN(distans) || Number.isNaN(tid)) {
      toast('Skriv ett positivt tal, t.ex. 4,2');
      return;
    }
    if (distans === undefined && tid === undefined) {
      toast('Fyll i distans eller tid');
      return;
    }

    const ts = nuISO();
    await addSet({
      datum,
      pass: LOPPASS_ID,
      ...(distans !== undefined ? { distans_km: distans } : {}),
      ...(tid !== undefined ? { tid_min: tid } : {}),
      ts,
      tsEpoch: Date.parse(ts),
      synced: 0,
    });

    const { vecka, veckoLogg, veckoMarkeringar, angerbart } = await veckoState(idag);
    setState({
      vecka, veckoLogg, veckoMarkeringar, angerbart, loppassOppet: false,
    });
    await uppdateraBadge();
    synka();
    toast(`Löppass sparat — ${lopSammanfattning(distans, tid)}`);
  });

  return wrapper;
}

// Programmet gick inte att hämta men cachen räddade passet. Medvetet INTE
// felruta() — appen fungerar, den är bara inaktuell, och att ersätta hela UI:t
// vore fel proportion. Och inte toast(), som försvinner efter 2,5 s: det här är
// ett tillstånd som består mellan sessioner tills någon rättar filen.
function programvarningskortHtml(varning) {
  return `
    <article class="kort varningskort">
      <h3 class="display">Visar senast sparade program</h3>
      <p>Det aktuella programmet kunde inte hämtas, så appen kör vidare på den version
         som sparades senast. Ändringar från coachen syns alltså inte än.</p>
      <p class="varningskort-anledning">${esc(varning)}</p>
      <div class="avstamning-knappar">
        <button class="knapp-diskret" data-ladda-om>${IKON.aterstall} Försök igen</button>
      </div>
    </article>`;
}

function avstamningskortHtml(avstamning, program) {
  const { vecka, etikett, saknade, genomforda, totalt } = avstamning;
  return `
    <article class="kort avstamningskort">
      <h3 class="display">${esc(veckoRubrik(vecka, etikett))}</h3>
      <p>${genomforda} av ${totalt} pass loggade. ${esc(listaNamn(saknade, program))} saknas.</p>
      <div class="avstamning-knappar">
        <button class="knapp primar" data-bekrafta>Ej genomfört ${IKON.ejGenomfort}</button>
        <button class="knapp-diskret" data-avvisa>Avvisa</button>
      </div>
    </article>`;
}

/* ---------- ⋮-meny på passkortet ---------- */

function passMenySheet(pass, state, vecka) {
  const markerat = state.veckoMarkeringar.includes(pass.id);
  const val = markerat
    ? `<button class="meny-val" data-angra>${IKON.aterstall} Ångra — passet är inte längre markerat</button>`
    : `<button class="meny-val" data-markera>${IKON.ejGenomfort} Markera som ej genomfört den här veckan</button>`;

  const wrapper = el(`
    <div class="meny-wrapper">
      <div class="installningar-backdrop" data-stang></div>
      <div class="installningar-sheet" role="dialog" aria-label="Alternativ för passet">
        <h2 class="display">${esc(pass.namn)}</h2>
        <p>${markerat
    ? 'Passet räknas som ej genomfört den här veckan. Raden skrivs till loggen först när veckan är slut.'
    : 'Hoppar du över passet den här veckan hamnar det i loggen som ej genomfört när veckan är slut.'}</p>
        <div class="meny-lista">${val}</div>
      </div>
    </div>`);

  wrapper.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stang]')) {
      setState({ passMeny: null });
      return;
    }
    const vill = e.target.closest('[data-markera]') ? 'markera' : e.target.closest('[data-angra]') ? 'angra' : null;
    if (!vill) return;

    const nyckel = vecka.nyckel;
    const ok = vill === 'markera' ? await markera(nyckel, pass.id) : await angraMarkering(nyckel, pass.id);
    if (!ok) {
      toast('Veckan är avstämd och skickad till loggen');
      setState({ passMeny: null });
      return;
    }
    setState({ veckoMarkeringar: await markeradeFor(nyckel), passMeny: null });
  });

  return wrapper;
}

/* ---------- avstämning av förra veckan ---------- */

async function bekraftaAvstamning(avstamning, program, skriv) {
  if (!avstamning) return;
  if (skriv) await emittera(avstamning.vecka, avstamning.sistaDatum, avstamning.saknade);
  await markeraHanterad(avstamning.vecka);
  setState({ veckoAvstamning: null });
  if (skriv) {
    await uppdateraBadge();
    const flera = avstamning.saknade.length > 1;
    toast(`${listaNamn(avstamning.saknade, program)} ${flera ? 'loggade som ej genomförda' : 'loggat som ej genomfört'}`);
    // Statusraderna gör avslutet oåterkalleligt så snart de lämnat enheten.
    // Synken väntas inte in — men när den är klar ska ångra-knappen försvinna,
    // annars står den kvar och erbjuder något som skulle nekas.
    synka().then(async () => {
      const { angerbart } = await veckoState(todayISO());
      setState({ angerbart });
    });
  }
}

function synkText(osynkade, synkStatus) {
  if (AR_DEMO) return 'Demo · ingen synk';
  if (synkStatus === 'syncing') return 'Synkar …';
  if (!getToken()) return osynkade ? `${osynkade} osynkade · synk ej konfigurerad` : 'Synk ej konfigurerad';
  if (synkStatus === 'error') return `Synkfel · ${osynkade} osynkade`;
  return osynkade ? `${osynkade} osynkade` : 'Allt synkat';
}

/* ---------- Inställningar (synk + notiser) ---------- */

// Notisdelen speglar aktuellt tillstånd — knappen visas bara när en begäran
// är meningsfull ('default'). Själva notisen skickas från timer.js.
function notisSektionHtml() {
  if (!('Notification' in window)) {
    return '<p>Stöds inte här — på iPhone krävs att appen lagts till på hemskärmen (iOS 16.4+). Vibration och pip funkar ändå.</p>';
  }
  if (Notification.permission === 'granted') return '<p>Notiser på — du får en notis när vilan är slut.</p>';
  if (Notification.permission === 'denied') return '<p>Notiser blockerade — slå på dem för appen i systeminställningarna.</p>';
  return `<button class="knapp primar" data-notis>Aktivera notis när vilan är slut</button>`;
}

// Vilket app-skal som faktiskt körs. Versionen är cachenamnet service workern
// skapade (`shell-vN` ur app/sw.js, bumpat av pre-commit-hooken) — ingen ny
// versionshantering införs, det är den som redan finns. Att sidan över huvud
// taget kontrolleras av en service worker visas separat: en okontrollerad sida
// hämtar allt från nätet och beter sig helt annorlunda.
// Väntar in att en nyinstallerad service worker faktiskt aktiverats innan sidan
// laddas om. Utan väntan hinner omladdningen före installationen, och man får
// samma gamla skal igen — knappen skulle alltså inte göra det den lovar.
// Timeouten är sista utvägen: fastnar installationen är en omladdning ändå
// bättre än en knapp som inte gör något.
function vantaPaAktivering(arbetare) {
  return new Promise((klar) => {
    const stopp = setTimeout(klar, 5000);
    arbetare.addEventListener('statechange', () => {
      if (arbetare.state === 'activated') {
        clearTimeout(stopp);
        klar();
      }
    });
  });
}

async function tvingaUppdatering() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) {
    await reg.update();
    const ny = reg.installing || reg.waiting;
    if (ny) await vantaPaAktivering(ny);
  }
  location.reload();
}

async function versionText() {
  if (!('serviceWorker' in navigator)) return '<p>Den här webbläsaren kör ingen service worker.</p>';

  const styrd = Boolean(navigator.serviceWorker.controller);
  let skal = null;
  try {
    // Normalt finns exakt en: activate städar bort de gamla. Ligger det flera
    // kvar pågår en uppdatering, och det är i sig värt att se.
    const namn = (await caches.keys()).filter((n) => n.startsWith('shell-'));
    skal = namn.length ? namn.join(', ') : null;
  } catch {
    // caches kan vara blockerat, t.ex. i privat läge — versionen är då okänd
  }

  return `<p>Skal: ${esc(skal || 'okänt')}</p>
    <p>${styrd ? 'Sidan serveras av service workern.' : 'Ingen service worker styr sidan — allt hämtas från nätet.'}</p>`;
}

function synkSektionerHtml() {
  return `
        <h2 class="display">Synk</h2>
        <p>Fingranulär GitHub-token för endast detta repo, med behörigheten <strong>Contents: Read and write</strong>. Läsdelen behövs för programmet och historiken. Sparas bara på den här enheten.</p>
        <label>Repo (användare/repo)<input id="synk-repo" autocapitalize="none" autocomplete="off" placeholder="anvandare/traningsprojekt"></label>
        <label>Branch<input id="synk-branch" autocapitalize="none" autocomplete="off" value="main"></label>
        <label>Token<input id="synk-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
        <button class="knapp primar" data-spara>Spara ${IKON.bock}</button>
        <h2 class="display">Historik</h2>
        <p>Hämtar loggen ur repot till den här enheten — behövs på en ny telefon eller efter rensad webbläsardata. Läser bara, skriver ingenting.</p>
        <button class="knapp-diskret" data-aterlas>${IKON.aterstall} Hämta historik från repot</button>`;
}

// I demon finns ingen synk att ställa in. Sektionen förklarar vad demon är och
// låter besökaren börja om med exempeldatan.
function demoSektionHtml() {
  return `
        <h2 class="display">Demo</h2>
        <p>Appen visar ett påhittat program och några veckors påhittad logg. Det du loggar sparas bara i den här webbläsaren och skickas ingenstans.</p>
        <button class="knapp-diskret" data-borja-om>${IKON.aterstall} Börja om med exempeldatan</button>`;
}

// Exporterad: main.js visar samma sheet ovanpå felrutan när programmet inte
// kunde laddas. Utan token finns inget program, och utan program renderas inte
// footern där sheeten annars öppnas — första starten vore en låst dörr.
export function installningarSheet() {
  const wrapper = el(`
    <div class="installningar-wrapper">
      <div class="installningar-backdrop" data-stang></div>
      <div class="installningar-sheet" role="dialog" aria-label="Inställningar">
        ${AR_DEMO ? demoSektionHtml() : synkSektionerHtml()}
        <h2 class="display">Notiser</h2>
        <div id="notis-sektion">${notisSektionHtml()}</div>

        <h2 class="display">Version</h2>
        <div id="version-sektion"><p>Läser …</p></div>
        <button class="knapp-diskret" data-uppdatera>Hämta senaste versionen</button>
      </div>
    </div>`);

  versionText().then((text) => {
    const ruta = wrapper.querySelector('#version-sektion');
    if (ruta) ruta.innerHTML = text;
  });

  if (!AR_DEMO) getRepoKonfig().then((konfig) => {
    if (konfig) {
      wrapper.querySelector('#synk-repo').value = `${konfig.agare}/${konfig.repo}`;
      wrapper.querySelector('#synk-branch').value = konfig.branch;
    }
    wrapper.querySelector('#synk-token').value = getToken();
  });

  wrapper.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stang]')) {
      setState({ installningarOppna: false });
      return;
    }
    // Escape-hatch när service workern fastnat på ett gammalt skal. Utan den
    // finns ingen väg ur annat än att avinstallera appen — och eftersom
    // cachen är cache-first märks det inte att man kör gammal kod.
    if (e.target.closest('[data-uppdatera]')) {
      await tvingaUppdatering();
      return;
    }
    if (e.target.closest('[data-borja-om]')) {
      await borjaOmDemo();
      return;
    }
    if (e.target.closest('[data-notis]')) {
      const status = await begarNotisTillstand(); // giltig user gesture
      wrapper.querySelector('#notis-sektion').innerHTML = notisSektionHtml();
      if (status === 'granted') toast('Notiser på');
      else if (status === 'denied') toast('Notiser blockerade');
      return;
    }
    const aterlasKnapp = e.target.closest('[data-aterlas]');
    if (aterlasKnapp) {
      if (!(await harSynkKonfig())) {
        toast('Spara repo och token först');
        return;
      }
      aterlasKnapp.disabled = true;
      aterlasKnapp.innerHTML = 'Hämtar …';
      try {
        const { importerade } = await aterlas();
        toast(importerade ? `${importerade} rader hämtade` : 'Allt fanns redan på enheten');
        // Veckorad, "Senast:" och avstämning byggs vid routeladdning — en
        // omladdning är enklaste vägen till en vy som speglar det nya innehållet.
        if (importerade) {
          location.reload();
          return;
        }
      } catch (fel) {
        console.warn('Återläsning misslyckades:', fel);
        toast('Kunde inte hämta historiken');
      }
      aterlasKnapp.disabled = false;
      aterlasKnapp.innerHTML = `${IKON.aterstall} Hämta historik från repot`;
      return;
    }

    if (!e.target.closest('[data-spara]')) return;

    const repoText = wrapper.querySelector('#synk-repo').value.trim();
    const branch = wrapper.querySelector('#synk-branch').value.trim() || 'main';
    const token = wrapper.querySelector('#synk-token').value.trim();
    const [agare, repo] = repoText.split('/');
    if (!agare || !repo) {
      toast('Ange repo som användare/repo');
      return;
    }
    await setRepoKonfig({ agare, repo, branch });
    setToken(token);
    setState({ installningarOppna: false });
    toast(token ? 'Sparat — synkar' : 'Sparat');

    // Kom vi hit från felrutan var det just token som saknades för att kunna
    // hämta programmet. Ladda om så hela booten körs igen med den på plats.
    if (getState().programFel) {
      location.reload();
      return;
    }
    if (!token) return;

    // Först nu vet appen var repot finns. Är enheten tom är det här ögonblicket
    // återläsningen ska ske — före första synken, så historiken finns på plats.
    try {
      const aterlast = await aterlasVidBehov();
      if (aterlast?.importerade) {
        toast(`${aterlast.importerade} rader historik hämtade`);
        location.reload();
        return;
      }
    } catch (fel) {
      console.warn('Återläsning misslyckades:', fel);
    }
    synka();
  });

  return wrapper;
}
