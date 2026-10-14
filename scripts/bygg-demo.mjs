#!/usr/bin/env node
// Bygger demons data i app/demo/ (läses av app/js/demo.js när appen öppnas med ?demo).
//
//   app/demo/program.json  kopia av data/program.json
//   app/demo/logg.jsonl    påhittad logg, sex veckor 2026-08-31 – 2026-10-11
//
// Loggen är deterministisk (fast frö), så filen blir likadan vid varje körning.
// Datumen är fasta här; demon flyttar dem till innevarande vecka när den läses in.
// Raderna skrivs i samma fältordning som appens serialiseraRad (app/js/sync.js),
// och de visar varje radtyp: set, byte (alt_for), anteckning, löppass och ett
// överhoppat pass.
//
// Anrop: node scripts/bygg-demo.mjs

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const ROT = new URL('..', import.meta.url).pathname;
const DEMO = join(ROT, 'app/demo');
const program = JSON.parse(readFileSync(join(ROT, 'data/program.json'), 'utf8'));

// Deterministisk slump så att filen blir likadan varje körning.
let fro = 20260831;
function slump() {
  fro |= 0; fro = (fro + 0x6d2b79f5) | 0;
  let t = Math.imul(fro ^ (fro >>> 15), 1 | fro);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const heltal = (min, max) => min + Math.floor(slump() * (max - min + 1));

// Vikterna före avstämningen 2026-09-28 (programmet visar läget efter).
const FORE_AVSTAMNING = { knaboj_smith: 50, rdl: 60, lutande_hantelpress: 16 };
const NY_OVNING = 'leg_extension';
const KALIBRERAD_VIKT = { leg_extension: 35 };

const VECKOSCHEMA = [
  { dag: 0, pass: 'upper1', tid: '17:32' },
  { dag: 1, pass: 'lower1', tid: '17:41' },
  { dag: 2, pass: 'lopning', tid: '07:05' },
  { dag: 3, pass: 'upper2', tid: '17:28' },
  { dag: 5, pass: 'lower2', tid: '10:14' },
];
const OVERHOPPAT = { vecka: '2026-W38', pass: 'lower2', sondag: '2026-09-20', ts: '2026-09-21T07:03:18+02:00' };
const BYTE = { datum: '2026-09-17', ovning: 'kabelcross', till: 'hantelflyes', vikt: 8 };
const ANTECKNINGAR = {
  '2026-09-08|lower1': 'Tung dag, dålig sömn.',
  '2026-09-17|upper2': 'Kabeln upptagen, körde flyes i stället.',
  '2026-10-06|lower1': 'Knäböjen gick lätt på nya vikten.',
};

const pad = (n) => String(n).padStart(2, '0');
function adderaDagar(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function tsFor(datum, sekunder) {
  const h = Math.floor(sekunder / 3600), m = Math.floor((sekunder % 3600) / 60), s = sekunder % 60;
  return `${datum}T${pad(h)}:${pad(m)}:${pad(s)}+02:00`; // sommartid hela perioden
}
const repsIntervall = (reps) => reps.replace('/ben', '').split('-').map(Number);

// Startläge per övning: reps i nedre halvan av intervallet.
const lage = {};
function lageFor(ovning, vikt) {
  if (!lage[ovning.id] || lage[ovning.id].vikt !== vikt) {
    const [min, max] = repsIntervall(ovning.reps);
    lage[ovning.id] = { vikt, reps: min + Math.floor((max - min) / 3) };
  }
  return lage[ovning.id];
}

const rader = [];
const FORSTA_MANDAG = '2026-08-31';

for (let vecka = 0; vecka < 6; vecka += 1) {
  const mandag = adderaDagar(FORSTA_MANDAG, vecka * 7);
  const iso = `2026-W${36 + vecka}`;

  for (const { dag, pass, tid } of VECKOSCHEMA) {
    const datum = adderaDagar(mandag, dag);
    const [hh, mm] = tid.split(':').map(Number);
    let klocka = hh * 3600 + mm * 60 + heltal(0, 59);

    if (pass === 'lopning') {
      const distans = Math.round((5 + slump() * 0.7) * 100) / 100;
      rader.push({ datum, pass, distans_km: distans, tid_min: heltal(29, 33), ts: tsFor(datum, klocka) });
      continue;
    }
    if (iso === OVERHOPPAT.vecka && pass === OVERHOPPAT.pass) {
      rader.push({ datum: OVERHOPPAT.sondag, pass, status: 'ej_genomfort', vecka: iso, ts: OVERHOPPAT.ts });
      continue;
    }

    const efterAvstamning = datum >= program.uppdaterad;
    const passet = program.pass.find((p) => p.id === pass);
    const passRader = [];

    for (const ovning of passet.ovningar) {
      if (ovning.id === NY_OVNING && !efterAvstamning) continue;

      let id = ovning.id;
      let vikt = ovning.vikt ?? KALIBRERAD_VIKT[ovning.id];
      if (!efterAvstamning && FORE_AVSTAMNING[ovning.id] != null) vikt = FORE_AVSTAMNING[ovning.id];
      let altFor = null;
      if (datum === BYTE.datum && ovning.id === BYTE.ovning) {
        id = BYTE.till; vikt = BYTE.vikt; altFor = ovning.id;
      }

      const [, max] = repsIntervall(ovning.reps);
      const st = lageFor({ ...ovning, id }, vikt);
      for (let set = 1; set <= ovning.set; set += 1) {
        const tapp = set === 1 ? 0 : heltal(0, set - 1);
        const reps = Math.max(1, Math.min(max, st.reps - tapp));
        const rir = Math.max(0, ovning.rir_mal + (set === 1 ? 1 : 0) - (set === ovning.set ? heltal(0, 1) : 0));
        const rad = { datum, pass, ovning: id, set, vikt, reps, rir, ts: tsFor(datum, klocka) };
        if (altFor) rad.alt_for = altFor;
        passRader.push(rad);
        klocka += 35 + ovning.vila_sek + heltal(-15, 25);
      }
      klocka += 60 + heltal(0, 60);
      // Dubbel progression: en rep till nästa vecka, upp till taket.
      if (!altFor) st.reps = Math.min(max, st.reps + heltal(0, 1));
    }

    const anteckning = ANTECKNINGAR[`${datum}|${pass}`];
    if (anteckning) passRader[passRader.length - 1].anteckning = anteckning;
    rader.push(...passRader);
  }
}

// Samma fältordning som appens serialiseraRad (app/js/sync.js).
function serialisera(r) {
  if (r.status) return JSON.stringify({ datum: r.datum, pass: r.pass, status: r.status, vecka: r.vecka, ts: r.ts });
  if (r.pass === 'lopning') return JSON.stringify({ datum: r.datum, pass: r.pass, distans_km: r.distans_km, tid_min: r.tid_min, ts: r.ts });
  const ut = { datum: r.datum, pass: r.pass, ovning: r.ovning, set: r.set, vikt: r.vikt, reps: r.reps, rir: r.rir, ts: r.ts };
  if (r.alt_for) ut.alt_for = r.alt_for;
  if (r.anteckning) ut.anteckning = r.anteckning;
  return JSON.stringify(ut);
}

rader.sort((a, b) => a.ts.localeCompare(b.ts));

mkdirSync(DEMO, { recursive: true });
copyFileSync(join(ROT, 'data/program.json'), join(DEMO, 'program.json'));
writeFileSync(join(DEMO, 'logg.jsonl'), rader.map(serialisera).join('\n') + '\n');
console.log(`bygg-demo: app/demo/program.json och app/demo/logg.jsonl (${rader.length} rader)`);
