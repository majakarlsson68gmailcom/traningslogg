// Skärm 3: vilotimern som bottom sheet över passvyn.
// Ringen och tiden uppdateras varje tick från main.js utan omrendering.
//
// Två lägen: nedräkning (återställ / paus / penna) och redigering (−15 / bock / +15)
// där −15/+15 ändrar själva vilotiden. Vilotid-knappen på övningskortet öppnar
// sheeten direkt i redigeringsläge.
//
// Tryck utanför sheeten DÖDAR inte timern — den minimeras till en pill som
// tickar vidare; tryck på pillen expanderar igen. Timern stängs helt bara
// via KLAR (stangTimer) eller när nästa set startar en ny.

import {
  restMs, arKlar, pausaEllerFortsatt, aterstallTimer, justeraDuration,
} from '../timer.js';
import { setState } from '../store.js';
import { mmss } from '../format.js';
import { IKON } from '../ikoner.js';
import { el, esc } from '../dom.js';

const RADIE = 90;
const OMKRETS = 2 * Math.PI * RADIE;

export function montera(state, rot) {
  const t = state.timer;
  if (!t) return;

  if (state.timerMinimerad) {
    const pill = el(`
      <button class="timer-pill" aria-label="Visa vilotimern">
        ${IKON.klocka} <span class="display" data-timer-tid>--:--</span>
      </button>`);
    pill.addEventListener('click', () => setState({ timerMinimerad: false }));
    rot.append(pill);
    uppdatera(state);
    return;
  }

  const redigerar = state.timerRedigering;

  const knappar = redigerar
    ? `
      <button class="timer-knapp" data-minus aria-label="Korta vilotiden 15 sekunder">−15</button>
      <button class="timer-paus" data-klar-redigering aria-label="Klar med vilotiden">${IKON.bock}</button>
      <button class="timer-knapp" data-plus aria-label="Förläng vilotiden 15 sekunder">+15</button>`
    : `
      <button class="timer-knapp" data-aterstall aria-label="Återställ timern">${IKON.aterstall}</button>
      <button class="timer-paus" data-paus aria-label="${t.pausadRestMs !== null ? 'Fortsätt' : 'Pausa'}">
        ${t.pausadRestMs !== null ? IKON.spela : IKON.paus}
      </button>
      <button class="timer-knapp" data-penna aria-label="Ändra vilotiden">${IKON.penna}</button>`;

  const sheet = el(`
    <div class="timer-wrapper">
      <div class="timer-backdrop" data-stang></div>
      <aside class="timer-sheet" role="dialog" aria-label="Vilotimer">
        <div class="timer-ring-holk">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle class="timer-ring-spar" cx="100" cy="100" r="${RADIE}"></circle>
            <circle class="timer-ring-fyllnad" cx="100" cy="100" r="${RADIE}"
              stroke-dasharray="${OMKRETS}" stroke-dashoffset="${OMKRETS}"></circle>
          </svg>
          <div class="timer-tid display" data-timer-tid>--:--</div>
        </div>
        <div class="timer-ovning" data-timer-ovning>${redigerar ? `Vilotid ${mmss(t.durationSek * 1000)}` : esc(t.ovningNamn || '')}</div>
        <div class="timer-knappar">${knappar}</div>
        ${notisHintHtml()}
      </aside>
    </div>`);

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-stang]')) setState({ timerMinimerad: true });
    else if (e.target.closest('[data-paus]')) pausaEllerFortsatt();
    else if (e.target.closest('[data-aterstall]')) aterstallTimer();
    else if (e.target.closest('[data-penna]')) setState({ timerRedigering: true });
    else if (e.target.closest('[data-klar-redigering]')) setState({ timerRedigering: false });
    else if (e.target.closest('[data-minus]')) justeraDuration(-15);
    else if (e.target.closest('[data-plus]')) justeraDuration(15);
  });

  rot.append(sheet);
  uppdatera(state);
}

// Notiser går inte att slå på härifrån — behörigheten begärs från en gest i
// Inställningar, aldrig i loggflödet. Raden säger bara varför det är tyst.
function notisHintHtml() {
  if (!('Notification' in window) || Notification.permission === 'granted') return '';
  return '<div class="timer-notishint">Notiser av — slå på under Inställningar → Notiser</div>';
}

// Anropas varje tick — patchar tid (sheet eller pill) och ring direkt i DOM.
export function uppdatera(state) {
  const t = state.timer;
  const tidEl = document.querySelector('[data-timer-tid]');
  if (!t || !tidEl) return;

  const rest = restMs(t);
  const klar = arKlar(t);
  tidEl.textContent = mmss(Math.max(0, rest)); // stannar på 00:00, räknar aldrig i minus

  // Klart-läget slår till mellan två renderingar, så klassen sätts här och
  // inte i markupen — annars syns omslaget först vid nästa omrendering.
  document.querySelector('.timer-sheet')?.classList.toggle('timer-klar', klar);
  document.querySelector('.timer-pill')?.classList.toggle('timer-klar', klar);

  const ovningEl = document.querySelector('[data-timer-ovning]');
  if (ovningEl && !state.timerRedigering) {
    ovningEl.textContent = klar ? 'Vilan är slut' : (t.ovningNamn || '');
  }

  const ring = document.querySelector('.timer-ring-fyllnad');
  if (!ring) return; // pillen har ingen ring

  const forflutenAndel = Math.min(1, Math.max(0, 1 - rest / (t.durationSek * 1000)));
  ring.style.strokeDashoffset = String(OMKRETS * (1 - forflutenAndel));
}
