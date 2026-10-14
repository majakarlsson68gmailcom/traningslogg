// Boot, routing och renderingsloop.
// Hash-router (#/ och #/pass/:id) ger Android-bakåtknapp och reload mid-pass gratis.
// Varje setState ritar om aktiv vy i sin helhet (DOM:en är liten); klockorna och
// timer-ringen uppdateras separat varje halvsekund utan omrendering.

import { getState, setState, subscribe } from './store.js';
import {
  rowsForDatum, lastSetFor, getSetting, allaSetFor,
} from './db.js';
import { laddaProgram } from './program.js';
import { synka, uppdateraBadge } from './sync.js';
import { aterupptaTimer, tick, initLjud } from './timer.js';
import { mmss, todayISO, foregaendeVecka } from './format.js';
import { avstamningFor, veckoState } from './veckostatus.js';
import { aterlasVidBehov } from './aterlasning.js';
import { el, esc, toast } from './dom.js';
import { AR_DEMO } from './lage.js';
import { IKON } from './ikoner.js';
import * as valjPass from './views/valj-pass.js';
import * as passVy from './views/pass.js';
import * as timerSheet from './views/timer-sheet.js';

const rot = document.getElementById('app');

function tolkaRoute() {
  const traff = location.hash.match(/^#\/pass\/(.+)$/);
  if (!traff) return { name: 'valj' };
  try {
    return { name: 'pass', passId: decodeURIComponent(traff[1]) };
  } catch {
    // Ogiltigt kodad adress (t.ex. ett ensamt %). Utan fångst kastar booten
    // innan hashchange-lyssnaren finns, och appen står still tills adressen
    // rensas för hand. En trasig route är bara startskärmen.
    return { name: 'valj' };
  }
}

// Hämtar det datan vyn behöver innan den renderas.
async function laddaRouteData(route) {
  const state = getState();
  if (!state.program) {
    setState({ route });
    return;
  }

  if (route.name === 'valj') {
    // Statusrader (överhoppade pass) ligger i datum-indexet men är inte set —
    // de hör inte i veckoraden.
    const { starter, vecka, veckoLogg, veckoMarkeringar, angerbart } = await veckoState(todayISO());
    const forra = foregaendeVecka(vecka, starter);
    setState({
      route,
      vecka,
      veckoLogg,
      veckoMarkeringar,
      angerbart,
      veckoAvstamning: await avstamningFor(state.program, forra.nyckel, forra.datumLista),
    });
    return;
  }

  const pass = state.program.pass.find((p) => p.id === route.passId);
  if (!pass) {
    location.hash = '#/';
    return;
  }
  const idag = todayISO();
  const sessionRader = (await rowsForDatum(idag))
    .filter((r) => r.pass === route.passId && !r.status)
    .sort((a, b) => a.tsEpoch - b.tsEpoch);

  // Dagens övningsbyten (slot → alternativ) styr vilka övningar som visas.
  const byten = (await getSetting(`byte:${idag}:${route.passId}`)) || {};

  // "Senast:" ska visa FÖRRA passets siffror — dagens session exkluderas.
  // Historiken (för PB) ska tvärtom innehålla ALLT, inklusive dagens set: ett
  // PB satt på set 1 måste kunna slås av set 3 i samma pass.
  const senastePerOvning = {};
  const historikPerOvning = {};
  for (const o of pass.ovningar) {
    const aktivId = byten[o.id] || o.id;
    senastePerOvning[aktivId] = await lastSetFor(aktivId, idag);
    historikPerOvning[aktivId] = await allaSetFor(aktivId);
  }

  // Byttes en övning mitt i passet och sidan laddades om, hör dagens rader till
  // en övning som inte längre är aktiv i något slot. De ska ändå kunna visa PB.
  for (const ovningId of new Set(sessionRader.map((r) => r.ovning))) {
    if (!historikPerOvning[ovningId]) historikPerOvning[ovningId] = await allaSetFor(ovningId);
  }

  const anteckningUtkast = (await getSetting(`utkast:${sessionRader[0]?.datum || idag}:${route.passId}`)) || '';
  setState({
    route,
    sessionRader,
    senastePerOvning,
    historikPerOvning,
    byten,
    anteckningUtkast,
    extraSet: {},
    ovningsMeny: null,
  });
}

/* ---------- rendering ---------- */

let forraRouteNyckel = null;

// Felrutan måste kunna öppna Inställningar. Utan data/ i deployen hämtas
// programmet via Contents API, vilket kräver token — och token-fältet bor
// annars bara i footern på "Välj pass", som inte renderas när programmet
// saknas. Utan den här knappen är första starten på en ny enhet en låst dörr.
// Länken till demon finns för den som hamnar här utan eget repo: en tom app
// som ber om en token visar ingenting av hur den fungerar.
function felruta(state) {
  const ruta = el(`
    <div class="felruta">
      <strong>Kunde inte ladda programmet</strong>
      <p>${esc(state.programFel)}</p>
      <div class="felruta-knappar">
        <button class="knapp primar" data-installningar>${IKON.reglage} Inställningar</button>
        <button class="knapp-diskret" data-forsok-igen>${IKON.aterstall} Försök igen</button>
        ${AR_DEMO ? '' : '<a class="knapp-diskret" href="./?demo">Prova demon med exempeldata</a>'}
      </div>
    </div>`);

  ruta.addEventListener('click', (e) => {
    if (e.target.closest('[data-installningar]')) setState({ installningarOppna: true });
    // Omladdning i stället för att köra om delar av booten: billigt i en PWA,
    // och hela startsekvensen (program, återläsning, synk) körs om i rätt ordning.
    else if (e.target.closest('[data-forsok-igen]')) location.reload();
  });
  return ruta;
}

function render(state) {
  if (state.programFel) {
    rot.replaceChildren(felruta(state));
    if (state.installningarOppna) rot.append(valjPass.installningarSheet());
    return;
  }
  if (!state.program) {
    rot.innerHTML = '<p class="laddar">Laddar program …</p>';
    return;
  }

  const routeNyckel = `${state.route.name}:${state.route.passId || ''}`;
  const y = window.scrollY;

  if (state.route.name === 'pass') passVy.render(state, rot);
  else valjPass.render(state, rot);
  timerSheet.montera(state, rot);

  // Behåll scrollpositionen vid omrendering inom samma vy, börja överst vid byte.
  window.scrollTo(0, routeNyckel === forraRouteNyckel ? y : 0);
  forraRouteNyckel = routeNyckel;

  uppdateraKlockor();
}

subscribe(render);

function uppdateraKlockor() {
  const state = getState();
  tick(); // timer-slutsignal, exakt en gång

  const klocka = document.getElementById('sessionsklocka');
  if (klocka && state.route.name === 'pass') {
    const forsta = state.sessionRader[0];
    klocka.textContent = forsta ? mmss(Date.now() - forsta.tsEpoch) : '--:--';
  }
  timerSheet.uppdatera(state);
}

setInterval(uppdateraKlockor, 500);

/* ---------- boot ---------- */

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // Ljudet måste låsas upp av en användargest innan timern kan pipa.
  document.addEventListener('pointerdown', initLjud);

  try {
    const { data, varning } = await laddaProgram();
    setState({ program: data, programVarning: varning });
  } catch (fel) {
    setState({ programFel: fel.message });
    return;
  }

  await aterupptaTimer();
  await uppdateraBadge();

  // Ny enhet: hämta historiken FÖRE vyn ritas, annars visas en tom veckorad som
  // sedan hoppar till. Gör inget på en enhet som redan har sin historik.
  try {
    const aterlast = await aterlasVidBehov();
    if (aterlast?.importerade) toast(`Hämtade ${aterlast.importerade} rader ur repot`);
  } catch (fel) {
    console.warn('Återläsning misslyckades, försöker igen vid nästa start:', fel);
  }

  await laddaRouteData(tolkaRoute());

  window.addEventListener('hashchange', () => laddaRouteData(tolkaRoute()));
  window.addEventListener('online', () => synka());
  // "Öppna PWA:n från hemskärmen" avfyrar varken boot eller online —
  // visibilitychange täcker det hålet. synka() guardar själv mot allt annat.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) synka();
  });
  synka();
}

boot();
