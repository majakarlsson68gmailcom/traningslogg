#!/usr/bin/env node
// Sammanställer loggen per vecka som underlag för coachens avstämning.
//
// Varför: coachen (skillen /coach) läser repot direkt och ska inte räkna set,
// volym och progression för hand ur JSONL. Skriptet gör räknandet; bedömningen
// är fortsatt coachens. Det ändrar ingenting — läser data/logg/, data/program.json
// och coach/muskelgrupper.json och skriver en rapport till stdout.
//
// Veckomodellen är appens egen (app/js/format.js), så veckorna här är exakt de
// appen bokför. Manuella veckostarter finns bara på telefonen (IndexedDB), men
// syns i loggen som `vecka`-värden på datumform på statusrader; de plockas upp
// automatiskt. En förskjuten vecka utan statusrader syns inte i loggen alls —
// sådana starter förs in i coach/veckostarter.json (eller ges med --start).
//
// Anrop:
//   node scripts/veckorapport.mjs                      → senaste 4 veckorna
//   node scripts/veckorapport.mjs --veckor 6           → senaste 6
//   node scripts/veckorapport.mjs --till 2026-08-23    → 4 veckor t.o.m. det datumet
//   node scripts/veckorapport.mjs --start 2026-08-23   → extra manuell veckostart
//   node scripts/veckorapport.mjs --json               → maskinläsbart i stället för text

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { veckaFor, foregaendeVecka, todayISO } from '../app/js/format.js';

const ROT = new URL('..', import.meta.url).pathname;
const LOGG_KATALOG = join(ROT, 'data/logg');
const PROGRAM = join(ROT, 'data/program.json');
const MUSKELGRUPPER = join(ROT, 'coach/muskelgrupper.json');
const VECKOSTARTER = join(ROT, 'coach/veckostarter.json');
const VOLYMGRANS = 10; // fraktionella set/muskel/vecka — nedre gräns i coach/PRINCIPER.md

/* ---------- argument ---------- */

function lasArgument(argv) {
  const a = { veckor: 4, till: todayISO(), starter: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--veckor') a.veckor = Number(argv[++i]);
    else if (arg === '--till') a.till = argv[++i];
    else if (arg === '--start') a.starter.push(argv[++i]);
    else if (arg === '--json') a.json = true;
    else {
      console.error(`Okänt argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(a.veckor) || a.veckor < 1) {
    console.error('--veckor måste vara ett heltal ≥ 1');
    process.exit(2);
  }
  return a;
}

/* ---------- inläsning ---------- */

function lasLogg() {
  const filer = readdirSync(LOGG_KATALOG).filter((f) => f.endsWith('.jsonl')).sort();
  const rader = [];
  for (const fil of filer) {
    const text = readFileSync(join(LOGG_KATALOG, fil), 'utf8');
    text.split('\n').forEach((rad, i) => {
      if (!rad.trim()) return;
      try {
        rader.push(JSON.parse(rad)); // okända fält behålls, som i återläsningen
      } catch {
        console.error(`Varning: ogiltig JSON i ${fil} rad ${i + 1} — hoppas över`);
      }
    });
  }
  return rader;
}

function lasJson(vag) {
  return JSON.parse(readFileSync(vag, 'utf8'));
}

function lasVeckostarter() {
  if (!existsSync(VECKOSTARTER)) return [];
  const fil = lasJson(VECKOSTARTER);
  return (fil.starter || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/* ---------- program ---------- */

// "8-12", "8-12/ben", "30-60 sek", "2" → { min, max }
function repsIntervall(reps) {
  const m = String(reps).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const n = String(reps).match(/\d+/);
  return n ? { min: Number(n[0]), max: Number(n[0]) } : null;
}

function programIndex(program) {
  const slot = new Map(); // `${pass}/${ovning}` → övningsobjekt
  for (const pass of program.pass) for (const o of pass.ovningar) slot.set(`${pass.id}/${o.id}`, o);
  const namn = new Map(Object.entries(program.ovningsnamn || {}));
  for (const pass of program.pass) for (const o of pass.ovningar) namn.set(o.id, o.namn);
  return { slot, namn };
}

function namnFor(index, id) {
  return index.namn.get(id) || id.replaceAll('_', ' ');
}

/* ---------- sammanställning ---------- */

function formatVikt(v) {
  if (v === null || v === undefined) return '–';
  if (v === 0) return 'KV';
  return String(v).replace('.', ',');
}

function sammanstallVecka(vecka, rader, program, index, karta, saknadeIKartan, till) {
  const iVeckan = (r) => vecka.datumLista.includes(r.datum);
  const setRader = rader.filter((r) => r.ovning && iVeckan(r));
  const statusRader = rader.filter((r) => r.status && (r.vecka === vecka.nyckel || iVeckan(r)));
  const lopRader = rader.filter((r) => !r.ovning && !r.status && iVeckan(r) && (r.distans_km != null || r.tid_min != null));

  // pass = datum + pass-id
  const passMap = new Map();
  for (const r of setRader) {
    const nyckel = `${r.datum}/${r.pass}`;
    if (!passMap.has(nyckel)) passMap.set(nyckel, { datum: r.datum, pass: r.pass, rader: [] });
    passMap.get(nyckel).rader.push(r);
  }

  const pass = [...passMap.values()]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((p) => sammanstallPass(p, index, program));

  const genomforda = new Set(pass.map((p) => p.pass));
  const ejGenomforda = statusRader.map((r) => r.pass);
  const saknas = program.pass.map((p) => p.id).filter((id) => !genomforda.has(id) && !ejGenomforda.includes(id));

  // fraktionell volym
  const volym = {};
  for (const r of setRader) {
    const bidrag = karta.ovningar[r.ovning];
    if (!bidrag) {
      saknadeIKartan.add(r.ovning);
      continue;
    }
    for (const [grupp, andel] of Object.entries(bidrag)) volym[grupp] = (volym[grupp] || 0) + andel;
  }

  return {
    nyckel: vecka.nyckel,
    start: vecka.start,
    slut: vecka.slut,
    etikett: vecka.etikett,
    pagar: vecka.slut >= till,
    antalSet: setRader.length,
    pass,
    ejGenomforda,
    saknas,
    lopning: lopRader.map((r) => ({ datum: r.datum, distans_km: r.distans_km ?? null, tid_min: r.tid_min ?? null })),
    lopningPlanerad: program.lopning?.pass_per_vecka ?? 0,
    volym,
  };
}

function sammanstallPass(p, index, program) {
  const perOvning = new Map();
  for (const r of p.rader) {
    if (!perOvning.has(r.ovning)) perOvning.set(r.ovning, []);
    perOvning.get(r.ovning).push(r);
  }
  const ovningar = [];
  for (const [id, rader] of perOvning) {
    rader.sort((a, b) => a.set - b.set);
    const original = rader[0].alt_for || id;
    const slotObj = index.slot.get(`${p.pass}/${original}`) || index.slot.get(`${p.pass}/${id}`);
    const intervall = slotObj ? repsIntervall(slotObj.reps) : null;
    const rirMal = slotObj?.rir_mal ?? null;

    const set = rader.map((r) => ({ set: r.set, vikt: r.vikt, reps: r.reps, rir: r.rir }));
    const underMal = rirMal == null ? 0 : set.filter((s) => typeof s.rir === 'number' && s.rir < rirMal).length;
    const iTaket = intervall && rirMal != null
      && set.every((s) => typeof s.reps === 'number' && s.reps >= intervall.max && typeof s.rir === 'number' && s.rir >= rirMal);
    const anteckningar = rader.map((r) => r.anteckning).filter(Boolean);

    ovningar.push({
      ovning: id,
      namn: namnFor(index, id),
      byte: rader[0].alt_for ? { for: original, namn: namnFor(index, original) } : null,
      set,
      antalSet: set.length,
      programSet: slotObj?.set ?? null,
      programReps: slotObj?.reps ?? null,
      programVikt: slotObj?.vikt ?? null,
      rirMal,
      signal: {
        hoj: Boolean(iTaket) && !rader[0].alt_for, // programmets vikt gäller originalövningen
        underMal,
        setAvviker: slotObj ? set.length !== slotObj.set : false,
      },
      anteckning: anteckningar.join(' · ') || null,
    });
  }
  const ts = p.rader.map((r) => Date.parse(r.ts)).filter(Number.isFinite);
  const langdMin = ts.length > 1 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 60000) : null;
  const passNamn = program.pass.find((x) => x.id === p.pass)?.namn || p.pass;
  return { datum: p.datum, pass: p.pass, namn: passNamn, antalSet: p.rader.length, langdMin, ovningar };
}

/* ---------- utskrift ---------- */

function skrivText(rapport, karta) {
  const ut = [];
  const rad = (s = '') => ut.push(s);
  const gruppNamn = (g) => karta.grupper?.[g] || g;

  for (const v of rapport.veckor) {
    const rubrik = v.nyckel.includes('-W') ? `Vecka ${v.nyckel.split('-W')[1]}` : 'Förskjuten vecka';
    rad(`## ${rubrik} · ${v.start} – ${v.slut}${v.pagar ? ' · pågår' : ''}`);
    rad(`Pass: ${v.pass.length} genomförda (${v.antalSet} set)`
      + (v.ejGenomforda.length ? ` · ej genomfört: ${v.ejGenomforda.join(', ')}` : '')
      + (v.saknas.length ? ` · inte loggat: ${v.saknas.join(', ')}` : ''));
    const lop = v.lopning.length
      ? v.lopning.map((l) => `${l.datum} ${l.distans_km ?? '?'} km / ${l.tid_min ?? '?'} min`).join(', ')
      : 'inget loggat';
    rad(`Löpning: ${lop} (planerat ${v.lopningPlanerad}/vecka)`);
    rad();

    for (const p of v.pass) {
      rad(`### ${p.namn} · ${p.datum} · ${p.antalSet} set` + (p.langdMin != null ? ` · ${p.langdMin} min` : ''));
      rad('| Övning | Set (vikt×reps@RIR) | Program | Signal |');
      rad('|---|---|---|---|');
      for (const o of p.ovningar) {
        const namn = o.byte ? `${o.namn} (byte för ${o.byte.namn})` : o.namn;
        const set = o.set.map((s) => `${formatVikt(s.vikt)}×${s.reps ?? '?'}@${s.rir ?? '?'}`).join(' ');
        const prog = o.programSet != null
          ? `${o.programSet}×${o.programReps} @ ${formatVikt(o.programVikt)} RIR ${o.rirMal}`
          : 'saknas i programmet';
        const signaler = [];
        if (o.signal.hoj) signaler.push('↑ höj vikten (taket nått)');
        if (o.signal.underMal) signaler.push(`RIR under mål: ${o.signal.underMal} set`);
        if (o.signal.setAvviker) signaler.push(`${o.antalSet}/${o.programSet} set`);
        rad(`| ${namn} | ${set} | ${prog} | ${signaler.join('; ')} |`);
        if (o.anteckning) rad(`| | _${o.anteckning}_ | | |`);
      }
      rad();
    }

    const grupper = Object.keys(karta.grupper || v.volym);
    if (grupper.length) {
      rad('Fraktionella set per muskelgrupp:');
      rad('| Muskel | Set | |');
      rad('|---|---|---|');
      for (const g of grupper) {
        const n = v.volym[g] || 0;
        const flagga = n < VOLYMGRANS ? `under ${VOLYMGRANS}` : '';
        rad(`| ${gruppNamn(g)} | ${String(n).replace('.', ',')} | ${flagga} |`);
      }
      rad();
    }
  }

  if (rapport.saknadeIKartan.length) {
    rad(`Varning: övningar utan post i coach/muskelgrupper.json (räknas inte i volymen): ${rapport.saknadeIKartan.join(', ')}`);
  }
  process.stdout.write(ut.join('\n') + '\n');
}

/* ---------- main ---------- */

const arg = lasArgument(process.argv.slice(2));
const program = lasJson(PROGRAM);
const karta = lasJson(MUSKELGRUPPER);
const rader = lasLogg();
const index = programIndex(program);

// manuella veckostarter: coach/veckostarter.json, statusraders `vecka` på
// datumform, plus --start
const starter = [...new Set([
  ...lasVeckostarter(),
  ...rader.filter((r) => r.status && /^\d{4}-\d{2}-\d{2}$/.test(r.vecka || '')).map((r) => r.vecka),
  ...arg.starter,
])].sort();

const veckor = [];
let v = veckaFor(arg.till, starter);
for (let i = 0; i < arg.veckor; i += 1) {
  veckor.unshift(v);
  v = foregaendeVecka(v, starter);
}

const saknadeIKartan = new Set();
const rapport = {
  genererad: todayISO(),
  till: arg.till,
  starter,
  veckor: veckor.map((vk) => sammanstallVecka(vk, rader, program, index, karta, saknadeIKartan, arg.till)),
  saknadeIKartan: [...saknadeIKartan].sort(),
};

if (arg.json) process.stdout.write(JSON.stringify(rapport, null, 2) + '\n');
else skrivText(rapport, karta);
