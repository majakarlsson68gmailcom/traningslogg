#!/usr/bin/env node
// Tester för loggradernas kontrakt: serialisering ut (app/js/sync.js) och
// tolkning in (app/js/aterlasning.js).
//
// Varför den här filen har tester när resten av appen inte har det: de två
// funktionerna är varandras spegelbild och går sönder TYST. En radtyp som
// saknas i serialiseringen skrivs som skräp till en append-only-logg som inte
// går att städa, och en radtyp som saknas i tolkningen försvinner vid
// återläsning — appen ser bara ut att sakna historik, ingenting säger ifrån.
// Loggen är dessutom coachens underlag, så ett fel här blir en felaktig
// träningsbedömning snarare än en synlig bugg.
//
// Alla tre radtyperna testas, inte bara löpraden: poängen är att den nya typen
// inte har trasat sönder de två som fanns.
//
// Anrop: node scripts/test-loggrader.mjs

import { serialiseraRad, dedupeNyckel } from '../app/js/sync.js';
import { tolkaRad } from '../app/js/aterlasning.js';
import { LOPPASS_ID } from '../app/js/format.js';

let fel = 0;
let kord = 0;

function test(namn, fn) {
  kord += 1;
  try {
    fn();
  } catch (e) {
    fel += 1;
    console.error(`  ✗ ${namn}\n      ${e.message}`);
  }
}

function pastaende(villkor, meddelande) {
  if (!villkor) throw new Error(meddelande);
}

function lika(fick, vantat, meddelande) {
  const a = JSON.stringify(fick);
  const b = JSON.stringify(vantat);
  if (a !== b) throw new Error(`${meddelande}: fick ${a}, väntade ${b}`);
}

const TS = '2026-09-20T18:12:05+02:00';

const setRad = {
  localId: 41, synced: 0, tsEpoch: Date.parse(TS),
  datum: '2026-09-20', pass: 'upper1', ovning: 'hantelbankpress',
  set: 2, vikt: 16, reps: 10, rir: 2, ts: TS,
};
const statusRad = {
  localId: 42, synced: 0, tsEpoch: Date.parse(TS),
  datum: '2026-09-20', pass: 'lower2', status: 'ej_genomfort', vecka: '2026-W38', ts: TS,
};
const lopRad = {
  localId: 43, synced: 0, tsEpoch: Date.parse(TS),
  datum: '2026-09-20', pass: LOPPASS_ID, distans_km: 4.2, tid_min: 28, ts: TS,
};

/* ---------- serialisering ut ---------- */

test('löpraden får kontraktets form och nyckelordning', () => {
  lika(
    serialiseraRad(lopRad),
    '{"datum":"2026-09-20","pass":"lopning","distans_km":4.2,"tid_min":28,"ts":"2026-09-20T18:12:05+02:00"}',
    'löprad',
  );
});

test('lokala fält läcker aldrig ut i loggen', () => {
  for (const rad of [setRad, statusRad, lopRad]) {
    const ut = JSON.parse(serialiseraRad(rad));
    pastaende(!('localId' in ut), `localId i ${rad.pass}`);
    pastaende(!('synced' in ut), `synced i ${rad.pass}`);
    pastaende(!('tsEpoch' in ut), `tsEpoch i ${rad.pass}`);
  }
});

test('ett mått som saknas utelämnas i stället för att bokföras som noll', () => {
  const baraTid = { ...lopRad, distans_km: undefined };
  const ut = JSON.parse(serialiseraRad(baraTid));
  pastaende(!('distans_km' in ut), 'distans_km skrevs trots att den saknades');
  lika(ut.tid_min, 28, 'tid_min');

  const baraDistans = { ...lopRad, tid_min: undefined };
  pastaende(!('tid_min' in JSON.parse(serialiseraRad(baraDistans))), 'tid_min skrevs trots att den saknades');
});

test('noll är ett värde och skrivs — bara null och undefined utelämnas', () => {
  const ut = JSON.parse(serialiseraRad({ ...lopRad, distans_km: 0 }));
  lika(ut.distans_km, 0, 'distans_km 0');
});

test('setrader och statusrader är oförändrade', () => {
  lika(
    serialiseraRad(setRad),
    '{"datum":"2026-09-20","pass":"upper1","ovning":"hantelbankpress","set":2,"vikt":16,"reps":10,"rir":2,"ts":"2026-09-20T18:12:05+02:00"}',
    'setrad',
  );
  lika(
    serialiseraRad(statusRad),
    '{"datum":"2026-09-20","pass":"lower2","status":"ej_genomfort","vecka":"2026-W38","ts":"2026-09-20T18:12:05+02:00"}',
    'statusrad',
  );
});

/* ---------- tolkning in ---------- */

test('alla tre radtyperna överlever en roundtrip genom återläsningen', () => {
  for (const rad of [setRad, statusRad, lopRad]) {
    const tillbaka = tolkaRad(serialiseraRad(rad));
    pastaende(tillbaka !== null, `${rad.pass} avvisades av tolkaRad`);
    lika(tillbaka.pass, rad.pass, 'pass');
    lika(tillbaka.datum, rad.datum, 'datum');
    lika(tillbaka.synced, 1, 'importerad rad ligger redan i repot');
    lika(tillbaka.tsEpoch, Date.parse(TS), 'tsEpoch');
    pastaende(!('localId' in tillbaka), 'localId kom utifrån');
  }
  const lop = tolkaRad(serialiseraRad(lopRad));
  lika(lop.distans_km, 4.2, 'distans_km');
  lika(lop.tid_min, 28, 'tid_min');
});

test('en löprad utan både distans och tid säger ingenting och avvisas', () => {
  const tom = '{"datum":"2026-09-20","pass":"lopning","ts":"2026-09-20T18:12:05+02:00"}';
  lika(tolkaRad(tom), null, 'tom löprad');
});

test('strängvärden i sifferfälten avvisas — de renderas i UI:t', () => {
  const distans = '{"datum":"2026-09-20","pass":"lopning","distans_km":"4,2","ts":"2026-09-20T18:12:05+02:00"}';
  lika(tolkaRad(distans), null, 'distans_km som sträng');
  const tid = '{"datum":"2026-09-20","pass":"lopning","tid_min":"28","ts":"2026-09-20T18:12:05+02:00"}';
  lika(tolkaRad(tid), null, 'tid_min som sträng');
});

test('en löprad utan ts går inte att sortera lokalt och avvisas', () => {
  lika(tolkaRad('{"datum":"2026-09-20","pass":"lopning","distans_km":4.2}'), null, 'saknad ts');
});

test('ett av måtten räcker', () => {
  const baraTid = tolkaRad('{"datum":"2026-09-20","pass":"lopning","tid_min":28,"ts":"2026-09-20T18:12:05+02:00"}');
  pastaende(baraTid !== null, 'löprad med bara tid avvisades');
  pastaende(!('distans_km' in baraTid), 'distans_km uppfanns');
});

test('en setrad med saknade fält avvisas fortfarande', () => {
  const utanRir = '{"datum":"2026-09-20","pass":"upper1","ovning":"x","set":1,"vikt":10,"reps":8,"ts":"2026-09-20T18:12:05+02:00"}';
  lika(tolkaRad(utanRir), null, 'setrad utan rir');
});

/* ---------- dedupe ---------- */

test('dedupenyckeln skiljer löprader från andra rader samma sekund', () => {
  const nycklar = new Set([setRad, statusRad, lopRad].map(dedupeNyckel));
  lika(nycklar.size, 3, 'tre rader ska ge tre nycklar');
});

test('samma löprad ger samma nyckel före och efter en roundtrip', () => {
  lika(
    dedupeNyckel(tolkaRad(serialiseraRad(lopRad))),
    dedupeNyckel(lopRad),
    'nyckeln ändrades av roundtrippen — importen skulle skapa en dubblett',
  );
});

/* ---------- kör ---------- */

if (fel) {
  console.error(`\ntest-loggrader: ${fel} av ${kord} test misslyckades\n`);
  process.exit(1);
}
console.error(`test-loggrader: ${kord} test ok`);
