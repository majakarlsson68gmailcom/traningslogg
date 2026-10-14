#!/usr/bin/env node
// Validerar data/program.json mot det appen faktiskt är beroende av.
//
// Varför: filen skrivs för hand (av coachen via Maja, eller av Claude Code) och
// inget annat kontrollerar den. Går den sönder kraschar inte appen — laddaProgram
// faller tillbaka på IndexedDB-cachen — men den gör det TYST, och telefonen kan
// visa ett inaktuellt program hur länge som helst utan att säga ifrån.
//
// Principen: blockera bara på det appen är beroende av. Okända fält ger varning,
// aldrig fel. Datakontraktet ägs av coachen; en hook som stoppar hennes framtida
// fält vore att ta över ägarskapet bakvägen. Samma tolerans finns på loggsidan,
// där återläsningen medvetet behåller fält den inte känner igen.
//
// Anrop:
//   node scripts/validera-program.mjs           → den STAGADE versionen (pre-commit),
//                                                  no-op när filen inte är stagad
//   node scripts/validera-program.mjs <fil>     → den filen (CI, manuell körning)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const VAG = 'data/program.json';

const OVNING_FALT = new Set([
  'id', 'namn', 'set', 'reps', 'vikt', 'rir_mal', 'vila_sek', 'alternativ', 'kommentar',
]);
const PASS_FALT = new Set(['id', 'namn', 'ovningar']);
const ROT_FALT = new Set(['version', 'uppdaterad', 'kommentar', 'ovningsnamn', 'pass', 'lopning']);

const fel = [];
const varningar = [];

const arHeltal = (v) => Number.isInteger(v);
const arStrang = (v) => typeof v === 'string' && v.trim() !== '';

// Speglar sista steget i namnForOvning (app/js/views/pass.js): ett alternativ-id
// utan egen definition OCH utan katalogpost renderas ur id:t. Fallbacken kan
// inte återskapa svenska tecken.
function harlettNamn(id) {
  const text = id.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lasKalla() {
  const argFil = process.argv[2];
  if (argFil && argFil !== '-') return { text: readFileSync(argFil, 'utf8'), kalla: argFil };

  // Utan argument: bara den stagade versionen är intressant. Arbetskopian kan
  // vara trasig medan det som committas är helt, och tvärtom.
  const stagade = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (!stagade.includes(VAG)) return null;
  return { text: execFileSync('git', ['show', `:${VAG}`], { encoding: 'utf8' }), kalla: `${VAG} (stagad)` };
}

function granskaOvning(passId, ovning, index) {
  const var_ = `${passId} › ${ovning?.id || `övning ${index + 1}`}`;
  if (typeof ovning !== 'object' || ovning === null || Array.isArray(ovning)) {
    fel.push(`${passId} › övning ${index + 1}: måste vara ett objekt`);
    return;
  }

  if (!arStrang(ovning.id)) fel.push(`${var_}: 'id' måste vara en icke-tom sträng`);
  if (!arStrang(ovning.namn)) fel.push(`${var_}: 'namn' måste vara en icke-tom sträng`);
  if (!arStrang(ovning.reps)) fel.push(`${var_}: 'reps' måste vara en sträng, t.ex. "8-12" (fick ${JSON.stringify(ovning.reps)})`);
  if (!arHeltal(ovning.set) || ovning.set < 1) fel.push(`${var_}: 'set' måste vara ett positivt heltal (fick ${JSON.stringify(ovning.set)})`);
  if (!arHeltal(ovning.vila_sek) || ovning.vila_sek < 1) fel.push(`${var_}: 'vila_sek' måste vara ett positivt heltal (fick ${JSON.stringify(ovning.vila_sek)})`);
  if (!arHeltal(ovning.rir_mal) || ovning.rir_mal < 0) fel.push(`${var_}: 'rir_mal' måste vara ett heltal ≥ 0 (fick ${JSON.stringify(ovning.rir_mal)})`);

  // vikt: tal = kg, 0 = kroppsvikt, null = kalibrera själv. En sträng ("50") ser
  // riktig ut i filen men går sönder i appens viktberäkningar.
  const viktOk = ovning.vikt === null || (typeof ovning.vikt === 'number' && Number.isFinite(ovning.vikt) && ovning.vikt >= 0);
  if (!('vikt' in ovning)) fel.push(`${var_}: 'vikt' saknas (tal = kg, 0 = kroppsvikt, null = kalibrera)`);
  else if (!viktOk) fel.push(`${var_}: 'vikt' måste vara ett tal ≥ 0 eller null (fick ${JSON.stringify(ovning.vikt)})`);

  if ('alternativ' in ovning) {
    if (!Array.isArray(ovning.alternativ)) {
      fel.push(`${var_}: 'alternativ' måste vara en lista med övnings-id`);
    } else {
      ovning.alternativ.forEach((a, i) => {
        if (!arStrang(a)) fel.push(`${var_}: alternativ ${i + 1} måste vara ett icke-tomt övnings-id (fick ${JSON.stringify(a)})`);
        else if (a === ovning.id) varningar.push(`${var_}: listar sitt eget id som alternativ — appen filtrerar bort det`);
      });
      const sedda = new Set();
      for (const a of ovning.alternativ) {
        if (arStrang(a) && sedda.has(a)) varningar.push(`${var_}: '${a}' står två gånger i 'alternativ'`);
        sedda.add(a);
      }
    }
  }

  if ('kommentar' in ovning && typeof ovning.kommentar !== 'string') {
    fel.push(`${var_}: 'kommentar' måste vara en sträng`);
  }

  for (const falt of Object.keys(ovning)) {
    if (!OVNING_FALT.has(falt)) varningar.push(`${var_}: okänt fält '${falt}' — appen ignorerar det`);
  }
}

function granska(prog) {
  if (typeof prog !== 'object' || prog === null || Array.isArray(prog)) {
    fel.push("Roten måste vara ett objekt");
    return;
  }
  if (!Array.isArray(prog.pass) || prog.pass.length === 0) {
    fel.push("'pass' måste vara en icke-tom lista");
    return;
  }

  for (const falt of Object.keys(prog)) {
    if (!ROT_FALT.has(falt)) varningar.push(`roten: okänt fält '${falt}' — appen ignorerar det`);
  }

  // ovningsnamn: id → visningsnamn för övningar som bara finns som alternativ.
  // Ett trasigt värde här visas för användaren, så det blockerar.
  const katalog = new Map();
  if ('ovningsnamn' in prog) {
    const k = prog.ovningsnamn;
    if (typeof k !== 'object' || k === null || Array.isArray(k)) {
      fel.push("'ovningsnamn' måste vara ett objekt: { \"ovnings_id\": \"Visningsnamn\" }");
    } else {
      for (const [id, namn] of Object.entries(k)) {
        if (!arStrang(namn)) fel.push(`ovningsnamn › ${id}: namnet måste vara en icke-tom sträng (fick ${JSON.stringify(namn)})`);
        else katalog.set(id, namn);
      }
    }
  }

  const passIdn = new Set();
  const definierade = new Set();

  for (const [i, pass] of prog.pass.entries()) {
    if (typeof pass !== 'object' || pass === null || Array.isArray(pass)) {
      fel.push(`pass ${i + 1}: måste vara ett objekt`);
      continue;
    }
    const passId = arStrang(pass.id) ? pass.id : `pass ${i + 1}`;
    if (!arStrang(pass.id)) fel.push(`pass ${i + 1}: 'id' måste vara en icke-tom sträng`);
    else if (passIdn.has(pass.id)) fel.push(`pass-id '${pass.id}' förekommer flera gånger`);
    else passIdn.add(pass.id);

    if (!arStrang(pass.namn)) fel.push(`${passId}: 'namn' måste vara en icke-tom sträng`);
    for (const falt of Object.keys(pass)) {
      if (!PASS_FALT.has(falt)) varningar.push(`${passId}: okänt fält '${falt}' — appen ignorerar det`);
    }

    if (!Array.isArray(pass.ovningar) || pass.ovningar.length === 0) {
      fel.push(`${passId}: 'ovningar' måste vara en icke-tom lista`);
      continue;
    }

    // Samma övnings-id i FLERA pass är avsiktligt (pullups, sidolyft, vadpress,
    // face_pull) — bara dubbletter inom samma pass är fel.
    const idnIPasset = new Set();
    for (const [j, ovning] of pass.ovningar.entries()) {
      granskaOvning(passId, ovning, j);
      const id = ovning?.id;
      if (arStrang(id)) {
        if (idnIPasset.has(id)) fel.push(`${passId}: övnings-id '${id}' förekommer flera gånger i samma pass`);
        idnIPasset.add(id);
        definierade.add(id);
      }
    }
  }

  // Alternativ-id utan egen definition är normen i den här filen, inte ett fel —
  // namnet tas då ur `ovningsnamn`, och saknas det också härleds det ur id:t.
  // Bara det sista fallet är värt en varning: härledningen tappar svenska tecken
  // och visas för användaren i bytesmenyn.
  const anvanda = new Set();
  const utanNamn = new Map();
  for (const pass of prog.pass) {
    if (!Array.isArray(pass?.ovningar)) continue;
    for (const ovning of pass.ovningar) {
      for (const a of ovning?.alternativ || []) {
        if (!arStrang(a) || definierade.has(a)) continue;
        if (katalog.has(a)) anvanda.add(a);
        else utanNamn.set(a, harlettNamn(a));
      }
    }
  }
  if (utanNamn.size) {
    varningar.push(`${utanNamn.size} alternativ-id saknar både definition och post i 'ovningsnamn' — visas via id-fallbacken:`);
    for (const [id, namn] of [...utanNamn].sort()) varningar.push(`    ${id.padEnd(24)} → "${namn}"`);
  }

  // En katalogpost som ingen refererar är oftast en felstavad nyckel — den gör
  // ingenting, och utan den här varningen syns det aldrig.
  const oanvanda = [...katalog.keys()].filter((id) => !anvanda.has(id));
  if (oanvanda.length) {
    varningar.push(`${oanvanda.length} post(er) i 'ovningsnamn' används inte av något alternativ (stavfel i nyckeln?):`);
    for (const id of oanvanda.sort()) varningar.push(`    ${id}`);
  }
}

/* ---------- kör ---------- */

const kalla = lasKalla();
if (!kalla) process.exit(0); // inte stagad — inget att göra

let prog;
try {
  prog = JSON.parse(kalla.text);
} catch (e) {
  console.error(`\nvalidera-program: ${kalla.kalla} är inte giltig JSON.\n  ${e.message}\n`);
  process.exit(1);
}

granska(prog);

if (varningar.length) {
  console.error(`\nvalidera-program: ${varningar.length} varning(ar) i ${kalla.kalla} (blockerar inte):`);
  for (const v of varningar) console.error(`  ${v}`);
}

if (fel.length) {
  console.error(`\nvalidera-program: ${fel.length} fel i ${kalla.kalla} — commiten stoppas:`);
  for (const f of fel) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}

console.error(`validera-program: ${kalla.kalla} ok (${prog.pass.length} pass, ${prog.pass.reduce((n, p) => n + p.ovningar.length, 0)} övningar)`);
