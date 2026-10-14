#!/usr/bin/env node
// Tester för PB-regeln (app/js/pb.js).
//
// Varför just den här filen har tester när resten av appen inte har det:
// regeln är ren logik med fler kantfall än den ser ut att ha ("eller tyngre",
// RIR åt båda håll, kroppsvikt, ordning i tid), och den syns bara som en liten
// stjärna i UI:t. Går den sönder märks det inte — den blir bara tyst, eller
// firar fel set. Resten av appen är DOM och IndexedDB och verifieras i webbläsaren.
//
// Anrop: node scripts/test-pb.mjs

import { arPB, rekordFor, pbLocalIds } from '../app/js/pb.js';

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

// Kortform: set(vikt, reps, rir). tsEpoch stiger med anropsordningen så att
// listor skrivna i läsordning också är kronologiska.
let klocka = 0;
const set = (vikt, reps, rir, localId = null) => ({
  vikt, reps, rir, localId, tsEpoch: (klocka += 1000),
});

/* ---------- grundfallen ---------- */

test('första setet någonsin på en vikt är PB', () => {
  pastaende(arPB(set(70, 5, 2), [], 2), '70 × 5 @ RIR 2 borde vara PB utan historik');
});

test('fler reps på samma vikt är PB', () => {
  const tidigare = [set(35, 10, 1)];
  pastaende(arPB(set(35, 11, 1), tidigare, 1), '11 reps borde slå 10');
});

test('lika många reps är inte PB', () => {
  const tidigare = [set(35, 10, 1)];
  pastaende(!arPB(set(35, 10, 1), tidigare, 1), '10 reps borde inte slå 10');
});

test('färre reps är inte PB', () => {
  const tidigare = [set(35, 10, 1)];
  pastaende(!arPB(set(35, 9, 1), tidigare, 1), '9 reps borde inte slå 10');
});

/* ---------- "eller tyngre": skyddet mot falska PB på lätta dagar ---------- */

test('lättare vikt slår inte ett rekord satt på tyngre vikt', () => {
  const tidigare = [set(35, 10, 1)];
  pastaende(!arPB(set(30, 9, 1), tidigare, 1), '30 kg × 9 borde inte vara PB när 35 kg × 10 finns');
});

test('lättare vikt ÄR PB om den slår allt tyngre också', () => {
  const tidigare = [set(35, 10, 1)];
  pastaende(arPB(set(30, 20, 1), tidigare, 1), '30 kg × 20 slår 10 reps och borde vara PB');
});

test('tyngre vikt jämförs inte mot lättare set', () => {
  const tidigare = [set(30, 20, 1)];
  pastaende(arPB(set(40, 6, 1), tidigare, 1), '40 kg × 6 borde vara PB — 30 kg × 20 är lättare');
});

/* ---------- RIR-kravet, åt båda håll ---------- */

test('grindat set (under mål-RIR) är aldrig PB', () => {
  pastaende(!arPB(set(35, 15, 0), [], 1), 'RIR 0 med mål 1 borde inte ge PB ens utan historik');
});

test('grindat set höjer inte ribban för kommande set', () => {
  const tidigare = [set(35, 15, 0)]; // grindat, ska ignoreras helt
  pastaende(arPB(set(35, 11, 1), tidigare, 1), '11 reps @ RIR 1 borde vara PB — det grindade 15-setet räknas inte');
});

test('högre RIR än målet duger', () => {
  const tidigare = [set(35, 10, 1)];
  pastaende(arPB(set(35, 11, 3), tidigare, 1), 'RIR 3 med mål 1 är lättare än målet och borde duga');
});

/* ---------- kroppsvikt, tid och skräprader ---------- */

test('kroppsvikt (vikt 0) fungerar som vilken vikt som helst', () => {
  const tidigare = [set(0, 5, 1)];
  pastaende(arPB(set(0, 6, 1), tidigare, 1), 'pullups: 6 reps borde slå 5');
  pastaende(!arPB(set(0, 5, 1), tidigare, 1), 'pullups: 5 reps borde inte slå 5');
});

/* ---------- assisterande vikt: negativ vikt = assist, mindre assist = tyngre ---------- */

test('mindre assistans räknas som tyngre', () => {
  const tidigare = [set(-15, 12, 1)]; // 12 reps med 15 kg assist
  pastaende(arPB(set(-10, 8, 1), tidigare, 1), '8 reps @ −10 borde vara PB — −15-setet är lättare och räknas inte');
});

test('mer assistans måste slå även tyngre set', () => {
  const tidigare = [set(-10, 8, 1)];
  pastaende(!arPB(set(-15, 8, 1), tidigare, 1), '8 reps @ −15 borde inte slå 8 reps @ −10');
  pastaende(arPB(set(-15, 9, 1), tidigare, 1), '9 reps @ −15 slår allt på −15 och uppåt');
});

test('kroppsvikt räknas som tyngre än all assistans', () => {
  const tidigare = [set(0, 3, 1)]; // 3 strikta pullups
  pastaende(!arPB(set(-10, 3, 1), tidigare, 1), '3 reps @ −10 borde inte slå 3 reps på kroppsvikt');
  pastaende(arPB(set(-10, 4, 1), tidigare, 1), '4 reps @ −10 slår rekordet 3');
  pastaende(rekordFor([set(-10, 8, 1), ...tidigare], -10, 1) === 8, 'rekordet på −10 väger in både assist- och kroppsviktsset');
});

test('statusrader utan setfält ignoreras', () => {
  const tidigare = [{ status: 'ej_genomfort', tsEpoch: 1 }, set(35, 10, 1)];
  pastaende(!arPB(set(35, 9, 1), tidigare, 1), 'statusraden får inte störa rekordet');
  pastaende(!arPB({ status: 'ej_genomfort' }, [], 1), 'en statusrad är aldrig själv ett PB');
});

test('rekordFor ger 0 när inget kvalificerat set finns', () => {
  pastaende(rekordFor([], 35, 1) === 0, 'tom historik borde ge 0');
  pastaende(rekordFor([set(35, 20, 0)], 35, 1) === 0, 'bara grindade set borde ge 0');
});

/* ---------- pbLocalIds: ordning i tid ---------- */

test('bara rader före i tid räknas — set 1 behåller sin stjärna', () => {
  const rader = [set(35, 10, 1, 'a'), set(35, 11, 1, 'b'), set(35, 11, 1, 'c')];
  const pb = pbLocalIds(rader, 1);
  pastaende(pb.has('a'), 'set 1 var PB när det loggades och ska förbli markerat');
  pastaende(pb.has('b'), 'set 2 slog set 1 och ska vara PB');
  pastaende(!pb.has('c'), 'set 3 slog ingenting');
});

test('pbLocalIds sorterar själv på tid', () => {
  const forst = set(35, 10, 1, 'forst');
  const sedan = set(35, 11, 1, 'sedan');
  const pb = pbLocalIds([sedan, forst], 1); // medvetet fel ordning in
  pastaende(pb.has('forst') && pb.has('sedan'), 'båda var PB i kronologisk ordning');
});

/* ---------- regression mot Majas riktiga crunch-logg ---------- */

// Ur data/logg/, mål-RIR 1. De två RIR 0-seten ska vara osynliga för regeln.
test('crunch_maskin: rekordet att slå på 35 kg är 10 reps', () => {
  klocka = 0;
  const historik = [
    set(30, 20, 3), // 2026-07-30
    set(40, 5, 0), // grindat
    set(35, 7, 0), // grindat
    set(35, 10, 3), // 2026-08-06
    set(35, 10, 1),
    set(35, 8, 0), // grindat
  ];
  pastaende(rekordFor(historik, 35, 1) === 10, `rekordet på 35 kg borde vara 10, fick ${rekordFor(historik, 35, 1)}`);
  pastaende(arPB(set(35, 11, 1), historik, 1), '11 reps @ RIR 1 borde vara PB');
  pastaende(!arPB(set(35, 10, 1), historik, 1), '10 reps borde inte räcka');
  pastaende(!arPB(set(35, 15, 0), historik, 1), '15 grindade reps borde inte ge PB');
  pastaende(!arPB(set(30, 15, 1), historik, 1), '30 kg × 15 borde inte slå 30 kg × 20');
});

/* ---------- kör ---------- */

if (fel) {
  console.error(`\ntest-pb: ${fel} av ${kord} test misslyckades\n`);
  process.exit(1);
}
console.error(`test-pb: ${kord} test ok`);
