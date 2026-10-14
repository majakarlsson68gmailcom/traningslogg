#!/usr/bin/env node
// Tester för demons datumflytt (app/js/demo.js).
//
// Varför: exempelloggen har fasta datum och flyttas till innevarande vecka när
// demon öppnas. Flyttas den fel syns det bara som en konstig veckorad, eller som
// en veckoavstämning som frågar efter pass som finns. Kantfallen är desamma som i
// veckomodellen: söndagar, sommartid och årsskiften, där ISO-veckan hör till
// föregående år.
//
// Anrop: node scripts/test-demo.mjs

import { flyttDagar, flyttaRad } from '../app/js/demo.js';
import { tolkaRad } from '../app/js/aterlasning.js';
import { veckodagsBokstav } from '../app/js/format.js';

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

function lika(fick, vantat, vad) {
  pastaende(fick === vantat, `${vad}: väntade ${vantat}, fick ${fick}`);
}

const rad = (obj) => tolkaRad(JSON.stringify(obj));
const SET = rad({ datum: '2026-10-10', pass: 'lower2', ovning: 'marklyft', set: 1, vikt: 90, reps: 6, rir: 2, ts: '2026-10-10T10:14:31+02:00' });
const STATUS = rad({ datum: '2026-09-20', pass: 'lower2', status: 'ej_genomfort', vecka: '2026-W38', ts: '2026-09-21T07:03:18+02:00' });

/* ---------- flytten ---------- */

test('loggens sista vecka hamnar på innevarande vecka', () => {
  // Loggen slutar lördag 2026-10-10 (vecka 41), i dag är onsdag 2026-11-04 (vecka 45).
  const dagar = flyttDagar('2026-10-10', '2026-11-04');
  lika(dagar, 28, 'dagar');
  lika(flyttaRad(SET, dagar).datum, '2026-11-07', 'flyttat datum');
});

test('flytten är alltid hela veckor, oavsett veckodag', () => {
  for (const idag of ['2026-11-02', '2026-11-05', '2026-11-08']) {
    lika(flyttDagar('2026-10-10', idag) % 7, 0, `rest för ${idag}`);
  }
});

test('ingen flytt när loggen redan slutar i innevarande vecka', () => {
  lika(flyttDagar('2026-10-10', '2026-10-11'), 0, 'dagar');
});

test('sommartidens slut ger ingen avrundning åt fel håll', () => {
  // 25 oktober 2026 är 25 timmar lång.
  lika(flyttDagar('2026-10-10', '2026-10-26'), 21, 'dagar över skiftet');
});

/* ---------- raden ---------- */

test('veckodag, klockslag och tidszon behålls', () => {
  const flyttad = flyttaRad(SET, 28);
  lika(veckodagsBokstav(flyttad.datum), veckodagsBokstav(SET.datum), 'veckodag');
  lika(flyttad.ts, '2026-11-07T10:14:31+02:00', 'ts');
});

test('tsEpoch följer med ts', () => {
  const flyttad = flyttaRad(SET, 28);
  lika(flyttad.tsEpoch, Date.parse(flyttad.ts), 'tsEpoch');
  lika(flyttad.tsEpoch - SET.tsEpoch, 28 * 86400000, 'skillnad i ms');
});

test('originalraden ändras inte', () => {
  flyttaRad(SET, 28);
  lika(SET.datum, '2026-10-10', 'datum');
});

test('statusradens vecka räknas om', () => {
  const flyttad = flyttaRad(STATUS, 28);
  lika(flyttad.datum, '2026-10-18', 'datum');
  lika(flyttad.vecka, '2026-W42', 'vecka');
});

test('statusrad över årsskiftet får föregående års ISO-vecka', () => {
  // Söndag 2027-01-03 tillhör vecka 53 av 2026 (2026 börjar på en torsdag).
  const flyttad = flyttaRad(STATUS, 105);
  lika(flyttad.datum, '2027-01-03', 'datum');
  lika(flyttad.vecka, '2026-W53', 'vecka');
});

/* ---------- kör ---------- */

if (fel) {
  console.error(`\ntest-demo: ${fel} av ${kord} test misslyckades\n`);
  process.exit(1);
}
console.error(`test-demo: ${kord} test ok`);
