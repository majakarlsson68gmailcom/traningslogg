// Demoläget (?demo): appen med påhittad exempeldata, för den som vill prova den
// utan eget repo och egen token.
//
// Tre garantier, i den ordning de är viktiga:
// 1. Demon rör aldrig riktig data. Den har en egen databas (db.js väljer namn
//    efter AR_DEMO) och synken är avstängd (harSynkKonfig i sync.js).
// 2. Det besökaren loggar stannar i webbläsaren. Ingenting skickas någonstans.
// 3. Exempeldatan ser aktuell ut. Loggen i app/demo/logg.jsonl har fasta datum
//    (skapad av scripts/bygg-demo.mjs) och flyttas hela veckor framåt när den
//    läses in, så att den slutar i innevarande vecka. Hela veckor bevarar
//    veckodagarna, och rader från i dag och framåt hoppas över.
//
// Flytten bestäms en gång, vid första besöket, och sparas. Programmets
// `uppdaterad` flyttas lika mycket varje gång programmet laddas, annars skulle
// förifyllningen (nyare program slår historiken) bete sig olika vecka för vecka.

import {
  addRader, getSetting, setSetting, sparaProgram, hamtaProgram, raderaDatabas,
} from './db.js';
import { tolkaRad, aterstallVeckoposter } from './aterlasning.js';
import { veckaFor, plusDagar, todayISO } from './format.js';

const FLYTT_NYCKEL = 'demo:flytt-dagar';
const demoFil = (namn) => new URL(`../demo/${namn}`, import.meta.url);

// Antal dagar som lägger loggens sista vecka på innevarande vecka. Alltid en
// multipel av sju. Räknas via middag, så sommartidsskiften inte ger 6,96 dagar.
export function flyttDagar(senasteDatum, idag) {
  const fran = new Date(`${veckaFor(senasteDatum).start}T12:00`);
  const till = new Date(`${veckaFor(idag).start}T12:00`);
  return Math.round((till - fran) / 86400000);
}

// En tolkad loggrad flyttad `dagar` framåt. ts behåller klockslag och tidszon.
// Statusraders `vecka` räknas om, eftersom nyckeln är veckan raden gäller.
export function flyttaRad(rad, dagar) {
  const datum = plusDagar(rad.datum, dagar);
  const ts = plusDagar(rad.ts.slice(0, 10), dagar) + rad.ts.slice(10);
  const flyttad = { ...rad, datum, ts, tsEpoch: Date.parse(ts) };
  if (rad.status) flyttad.vecka = veckaFor(datum).nyckel;
  return flyttad;
}

// Läser in exempelloggen i demons databas. Returnerar flytten i dagar.
async function lasInLoggen() {
  const svar = await fetch(demoFil('logg.jsonl'), { cache: 'no-store' });
  if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
  const rader = (await svar.text()).split('\n').filter((t) => t.trim()).map(tolkaRad).filter(Boolean);

  const idag = todayISO();
  const senaste = rader.reduce((max, r) => (r.datum > max ? r.datum : max), '');
  const dagar = flyttDagar(senaste, idag);
  const flyttade = rader
    .map((rad) => flyttaRad(rad, dagar))
    .filter((rad) => rad.datum < idag) // dagens pass är besökarens att logga
    .sort((a, b) => a.tsEpoch - b.tsEpoch);

  await addRader(flyttade);
  await aterstallVeckoposter(flyttade);
  return dagar;
}

// Demons motsvarighet till laddaProgram: samma returform, { data, varning }.
export async function laddaDemo() {
  let dagar = await getSetting(FLYTT_NYCKEL);
  try {
    if (dagar === undefined) {
      dagar = await lasInLoggen();
      await setSetting(FLYTT_NYCKEL, dagar);
    }
    const svar = await fetch(demoFil('program.json'), { cache: 'no-store' });
    if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
    const data = await svar.json();
    data.uppdaterad = plusDagar(data.uppdaterad, dagar);
    await sparaProgram(data, 'demo');
    return { data, varning: null };
  } catch (fel) {
    console.warn('Demodatan kunde inte hämtas:', fel);
    const cachad = await hamtaProgram();
    if (cachad) return { data: cachad, varning: null };
    throw new Error('Kunde inte ladda demon. Den behöver nät första gången den öppnas.');
  }
}

// "Börja om": tömmer demons databas, så att exempeldatan läses in på nytt med
// dagens datum. Riktig data ligger i en annan databas och påverkas inte.
export async function borjaOmDemo() {
  await raderaDatabas();
  location.reload();
}
