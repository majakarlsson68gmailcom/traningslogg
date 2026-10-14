#!/usr/bin/env node
// Bumpar CACHE i app/sw.js när någon precachad fil är på väg in i en commit.
//
// Varför det behövs: service workern precachar SKAL vid install, och webbläsaren
// installerar bara en ny worker om sw.js ändrats byte för byte. Glöms bumpen
// sitter telefonen kvar på gammal kod utan att märka det — och märker det aldrig,
// eftersom cache-first betyder att den inte ens frågar efter nya filer.
//
// Körs från .githooks/pre-commit. Bumpar aldrig två gånger i samma commit:
// har CACHE redan ändrats mot HEAD är jobbet gjort.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SW_VAG = 'app/sw.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function cacheVersion(kalla) {
  return kalla.match(/const CACHE = '([^']+)'/)?.[1] ?? null;
}

// './css/app.css' → 'app/css/app.css'. './' är navigationsfallbacket och pekar
// på index.html, som redan står med i listan — hoppas över.
function precachadeFiler(kalla) {
  const block = kalla.match(/const SKAL = \[([\s\S]*?)\];/)?.[1] ?? '';
  return [...block.matchAll(/'\.\/([^']*)'/g)]
    .map((m) => m[1])
    .filter(Boolean)
    .map((rel) => `app/${rel}`);
}

const kalla = readFileSync(SW_VAG, 'utf8');
const nuvarande = cacheVersion(kalla);
if (!nuvarande) {
  console.error(`bump-sw-cache: hittade ingen CACHE-rad i ${SW_VAG} — hoppar över.`);
  process.exit(0);
}

// Redan bumpad i den här commiten? Då är vi klara.
let iHead = null;
try {
  iHead = cacheVersion(git('show', `HEAD:${SW_VAG}`));
} catch {
  process.exit(0); // ingen HEAD ännu (första commiten) — inget att jämföra mot
}
if (iHead !== nuvarande) process.exit(0);

const stagade = new Set(git('diff', '--cached', '--name-only').split('\n').filter(Boolean));
const rorda = precachadeFiler(kalla).filter((f) => stagade.has(f));
if (rorda.length === 0) process.exit(0);

const nyVersion = nuvarande.replace(/(\d+)$/, (n) => String(Number(n) + 1));
if (nyVersion === nuvarande) {
  console.error(`bump-sw-cache: '${nuvarande}' slutar inte på en siffra — bumpa manuellt.`);
  process.exit(1);
}

writeFileSync(SW_VAG, kalla.replace(`const CACHE = '${nuvarande}'`, `const CACHE = '${nyVersion}'`));
git('add', SW_VAG);
console.error(`bump-sw-cache: ${nuvarande} → ${nyVersion} (${rorda.length} precachad(e) fil(er) ändrade)`);
