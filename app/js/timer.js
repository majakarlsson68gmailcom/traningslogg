// Vilotimern räknas alltid från timestamps (endsAtEpoch − nu), aldrig en
// tickande räknare — därför är den exakt även efter skärmlås eller reload.
//
// iOS-verklighet: navigator.vibrate finns inte, och notiser kan inte visas
// från en suspenderad sida utan push-backend (förbjudet enligt CLAUDE.md).
// Fallback: Screen Wake Lock håller skärmen vaken medan timern går, så sidan
// hinner nå nolltid i förgrunden och kan signalera.
//
// Vid nolltid stannar timern på 00:00 i ett klart-läge — den räknar inte vidare
// i minus. Övertiden var tänkt som information efter skärmlås, men utan tydlig
// slutsignal läses den bara som att timern hängt sig.

import { getState, setState } from './store.js';
import { setSetting, getSetting } from './db.js';

let wakeLock = null;
let audioCtx = null;

// Anropas på första user gesture — därefter får AudioContext spela ljud.
export function initLjud() {
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume();
}

function sparaTimer(timer) {
  setState({ timer });
  setSetting('timer', timer); // fire-and-forget: förlorad skrivning kostar bara reload-återupptag
}

// redigera=true öppnar sheeten i redigeringsläge (Vilotid-knappen på övningskortet).
export function startaTimer(durationSek, ovningNamn, redigera = false) {
  sparaTimer({
    endsAtEpoch: Date.now() + durationSek * 1000,
    durationSek,
    pausadRestMs: null,
    ovningNamn,
    signalerad: false,
  });
  setState({ timerRedigering: redigera, timerMinimerad: false });
  begarWakeLock();
}

export function stangTimer() {
  sparaTimer(null);
  setState({ timerRedigering: false, timerMinimerad: false });
  slappWakeLock();
}

export function pausaEllerFortsatt() {
  const t = getState().timer;
  if (!t) return;
  // Pausa en redan avslutad vila är meningslöst, och pausadRestMs skulle bli
  // negativ — då tappar vyn klart-läget och visar en frusen nolla utan förklaring.
  if (arKlar(t)) return;
  const ny = { ...t };
  if (ny.pausadRestMs === null) {
    ny.pausadRestMs = ny.endsAtEpoch - Date.now();
  } else {
    ny.endsAtEpoch = Date.now() + ny.pausadRestMs;
    ny.pausadRestMs = null;
  }
  sparaTimer(ny);
}

export function aterstallTimer() {
  const t = getState().timer;
  if (!t) return;
  sparaTimer({ ...t, endsAtEpoch: Date.now() + t.durationSek * 1000, pausadRestMs: null, signalerad: false });
}

// Ändrar själva vilotiden. Redan förfluten vila bevaras, så +15 mitt i en
// nedräkning fungerar som en förlängning. Gäller bara aktuell timer —
// nästa set startar åter med vila_sek ur programmet (coachen äger vilotiderna).
export function justeraDuration(deltaSek) {
  const t = getState().timer;
  if (!t) return;
  const ny = { ...t };
  const forflutetMs = ny.durationSek * 1000 - restMs(ny);
  ny.durationSek = Math.max(15, ny.durationSek + deltaSek);
  const nyRestMs = ny.durationSek * 1000 - forflutetMs;
  if (ny.pausadRestMs !== null) ny.pausadRestMs = nyRestMs;
  else ny.endsAtEpoch = Date.now() + nyRestMs;
  if (nyRestMs > 0) ny.signalerad = false;
  sparaTimer(ny);
}

export function restMs(t) {
  return t.pausadRestMs !== null ? t.pausadRestMs : t.endsAtEpoch - Date.now();
}

// Vilan är slut: används av vyn för att frysa siffran på 00:00 och slå om till
// klart-läget. En pausad timer räknas aldrig som klar.
export function arKlar(t) {
  return !!t && t.pausadRestMs === null && restMs(t) <= 0;
}

// Efter reload: återuppta en pågående/pausad timer, släng gammalt skräp (>5 min över).
export async function aterupptaTimer() {
  const sparad = await getSetting('timer');
  if (!sparad) return;
  if (sparad.pausadRestMs !== null || sparad.endsAtEpoch > Date.now() - 5 * 60 * 1000) {
    setState({ timer: sparad });
    begarWakeLock();
  } else {
    await setSetting('timer', null);
  }
}

// Hur långt efter nolltid en signal fortfarande betyder något. iOS fryser en
// bakgrundad webbapp, så tick() kan komma först när skärmen låses upp — en notis
// om en vila som tog slut för tio minuter sedan är brus, inte information.
const SIGNAL_FONSTER_MS = 90 * 1000;

// Körs varje tick från main.js: signalera exakt en gång när tiden går ut.
export function tick() {
  const t = getState().timer;
  if (!t || t.pausadRestMs !== null || t.signalerad) return;
  const rest = restMs(t);
  if (rest <= 0) {
    sparaTimer({ ...t, signalerad: true });
    if (rest > -SIGNAL_FONSTER_MS) signalera(t);
  }
}

// Begärs från en användargest i inställningssheeten — aldrig i loggflödet,
// en systemdialog efter första loggade setet vore ett extra tryck.
// På iOS finns Notification bara när appen är installerad på hemskärmen (16.4+).
export async function begarNotisTillstand() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') await Notification.requestPermission();
  return Notification.permission;
}

// Notisen visas oavsett om appen är i förgrunden eller inte. Villkoret var
// tidigare document.hidden, men på iOS finns ingen vibration och Web Audio är
// tyst i ljudlöst läge — med appen framme blev nolltiden då helt osignalerad.
// tag: en enda vilonotis åt gången, aldrig en stapel gamla.
function signalera(t) {
  navigator.vibrate?.([200, 100, 200]);
  pip();
  if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification('Vilan är slut', {
        body: t.ovningNamn || 'Dags för nästa set',
        icon: './icons/icon-192.png',
        tag: 'vila-slut',
      }))
      .catch(() => {});
  }
}

function pip() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  [0, 0.35].forEach((start) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    const t0 = audioCtx.currentTime + start;
    gain.gain.setValueAtTime(0.25, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  });
}

async function begarWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // nekad eller ej stödd — timern är ändå korrekt tack vare timestamps
  }
}

function slappWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && getState().timer) begarWakeLock();
});
