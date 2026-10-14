#!/usr/bin/env node
// Tester för veckomodellen (app/js/format.js).
//
// Varför den här filen har tester: veckogränsen avgör vilka set som räknas till
// vilken vecka, och vilken nyckel statusrader för överhoppade pass får i en
// append-only-logg. Räknar den fel skrivs rader som inte går att ta bort, och
// felet syns inte förrän coachen läser volymen. Logiken är dessutom ren och
// datumtung — kantfallen är söndagar, sommartid och årsskiften.
//
// Anrop: node scripts/test-vecka.mjs

import { veckaFor, foregaendeVecka, nastaVeckostart, veckoRubrik, veckodagsBokstav } from '../app/js/format.js';

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

/* ---------- utan manuella gränser: oförändrat ISO-beteende ---------- */

test('kalendervecka löper måndag–söndag', () => {
  const v = veckaFor('2026-08-20'); // torsdag
  lika(v.start, '2026-08-17', 'start');
  lika(v.slut, '2026-08-23', 'slut');
  lika(v.datumLista.length, 7, 'antal dagar');
  lika(v.nyckel, '2026-W34', 'nyckel');
});

test('måndag och söndag hamnar i samma vecka', () => {
  lika(veckaFor('2026-08-17').nyckel, veckaFor('2026-08-23').nyckel, 'nyckel mån vs sön');
});

test('föregående vecka är den närmast före', () => {
  const forra = foregaendeVecka(veckaFor('2026-08-20'));
  lika(forra.start, '2026-08-10', 'start');
  lika(forra.slut, '2026-08-16', 'slut');
  lika(forra.nyckel, '2026-W33', 'nyckel');
});

/* ---------- huvudfallet: avsluta veckan på en lördag ---------- */

const STARTER = ['2026-08-23']; // veckan avslutad lördag 22/8

test('den avslutade veckan kapas vid gränsen', () => {
  const v = veckaFor('2026-08-20', STARTER);
  lika(v.start, '2026-08-17', 'start');
  lika(v.slut, '2026-08-22', 'slut');
  lika(v.datumLista.length, 6, 'antal dagar');
  lika(v.nyckel, '2026-W34', 'nyckel — måndagsstart ger fortfarande ISO');
});

test('den nya veckan börjar på söndagen och snäpper tillbaka', () => {
  const v = veckaFor('2026-08-23', STARTER);
  lika(v.start, '2026-08-23', 'start');
  lika(v.slut, '2026-08-30', 'slut');
  lika(v.datumLista.length, 8, 'antal dagar');
  lika(v.nyckel, '2026-08-23', 'nyckel — förskjuten vecka identifieras av startdatum');
});

test('ett datum mitt i den förskjutna veckan hittar rätt vecka', () => {
  lika(veckaFor('2026-08-26', STARTER).start, '2026-08-23', 'start');
});

test('veckan därpå är en vanlig kalendervecka igen', () => {
  const v = veckaFor('2026-09-02', STARTER);
  lika(v.start, '2026-08-31', 'start');
  lika(v.slut, '2026-09-06', 'slut');
  lika(v.nyckel, '2026-W36', 'nyckel');
});

test('veckorna gränsar utan glapp eller överlapp', () => {
  const kedja = [veckaFor('2026-08-20', STARTER), veckaFor('2026-08-23', STARTER), veckaFor('2026-09-02', STARTER)];
  for (let i = 1; i < kedja.length; i += 1) {
    lika(foregaendeVecka(kedja[i], STARTER).start, kedja[i - 1].start, `vecka ${i} pekar tillbaka på ${i - 1}`);
  }
});

test('föregående vecka fungerar tvärs över en manuell gräns', () => {
  const forra = foregaendeVecka(veckaFor('2026-08-23', STARTER), STARTER);
  lika(forra.start, '2026-08-17', 'start');
  lika(forra.slut, '2026-08-22', 'slut');
});

/* ---------- kantfall ---------- */

test('avslut på en söndag ger en vanlig vecka därpå', () => {
  const starter = ['2026-08-24']; // avslutad söndag 23/8, alltså i tid ändå
  lika(veckaFor('2026-08-24', starter).slut, '2026-08-30', 'slut');
  lika(veckaFor('2026-08-24', starter).nyckel, '2026-W35', 'nyckel — måndagsstart');
});

test('två avslut i rad ger en endagsvecka, inte en tom', () => {
  const starter = ['2026-08-23', '2026-08-24'];
  const v = veckaFor('2026-08-23', starter);
  lika(v.start, '2026-08-23', 'start');
  lika(v.slut, '2026-08-23', 'slut');
  lika(v.datumLista.length, 1, 'antal dagar');
});

test('osorterade och dubblerade gränser ger samma svar', () => {
  const v = veckaFor('2026-08-26', ['2026-08-23', '2026-08-23']);
  lika(v.start, '2026-08-23', 'start');
  lika(v.slut, '2026-08-30', 'slut');
});

test('gränser i framtiden påverkar inte veckor före dem', () => {
  lika(veckaFor('2026-08-10', STARTER).slut, '2026-08-16', 'slut');
});

test('årsskifte: ISO-veckan tillhör året där torsdagen ligger', () => {
  lika(veckaFor('2027-01-01').nyckel, '2026-W53', 'nyckel');
  lika(veckaFor('2027-01-01').start, '2026-12-28', 'start');
});

test('sommartid: veckan är sju dagar också över skiftet', () => {
  lika(veckaFor('2026-10-27').datumLista.length, 7, 'okt (normaltid börjar)');
  lika(veckaFor('2026-03-31').datumLista.length, 7, 'mars (sommartid börjar)');
});

test('nästa veckostart är dagen efter avslutet, också över månadsskifte', () => {
  lika(nastaVeckostart('2026-08-22'), '2026-08-23', 'mitt i månaden');
  lika(nastaVeckostart('2026-08-31'), '2026-09-01', 'månadsskifte');
  lika(nastaVeckostart('2026-12-31'), '2027-01-01', 'årsskifte');
});

/* ---------- presentation ---------- */

test('rubriken visar veckonummer bara när det finns ett', () => {
  const kalender = veckaFor('2026-08-20');
  lika(veckoRubrik(kalender.nyckel, kalender.etikett), 'Vecka 34 · 17–23 aug', 'kalendervecka');
  const forskjuten = veckaFor('2026-08-23', STARTER);
  lika(veckoRubrik(forskjuten.nyckel, forskjuten.etikett), 'Veckan 23–30 aug', 'förskjuten vecka');
});

test('veckodagsbokstaven följer datumet, inte positionen i listan', () => {
  lika(veckodagsBokstav('2026-08-17'), 'M', 'måndag');
  lika(veckodagsBokstav('2026-08-23'), 'S', 'söndag');
  const v = veckaFor('2026-08-23', STARTER);
  lika(v.datumLista.map(veckodagsBokstav).join(''), 'SMTOTFLS', 'hela den förskjutna veckan');
});

/* ---------- kör ---------- */

if (fel) {
  console.error(`\ntest-vecka: ${fel} av ${kord} test misslyckades\n`);
  process.exit(1);
}
console.error(`test-vecka: ${kord} test ok`);
