// Återläsning: hämtar logghistoriken ur repot in i IndexedDB.
//
// Synken är envägs — appen skriver rader till data/logg/*.jsonl men har aldrig
// läst dem tillbaka. Följden: på en ny telefon, efter ominstallerad PWA eller
// rensad webbläsardata står appen tom trots att datan ligger trygg i git.
// "Senast:", PB och veckoraden byggs alla ur IndexedDB. Repot var en säker
// backup men inte en källa. Den här modulen stänger hålet.
//
// Ren läsväg: ingenting skrivs till repot och loggflödet i views/pass.js rörs
// inte. Importerade rader får synced=1 — de ligger redan i repot och får aldrig
// skickas tillbaka. Dedupe sker på samma nyckel som synken använder, så en
// import kan köras om hur många gånger som helst utan att skapa dubbletter.

import { allaRader, addRader, getSetting, setSetting } from './db.js';
import {
  dedupeNyckel, listaKatalogFranApi, hamtaFilFranApi, harSynkKonfig,
} from './sync.js';
import { markeraEmitterade } from './veckostatus.js';
import { LOPPASS_ID } from './format.js';

const KLAR_NYCKEL = 'aterlasning:klar';

const arText = (v) => typeof v === 'string' && v !== '';
const arTal = (v) => typeof v === 'number' && Number.isFinite(v);

// En JSONL-rad → IndexedDB-rad, eller null om raden inte går att lita på.
// Exporterad för scripts/test-loggrader.mjs — radtyperna är kontraktet mot coachen.
// tsEpoch driver ovning_tid-indexet och all sortering, så en rad utan giltig
// ts är oanvändbar lokalt — bättre att hoppa över den än att gissa.
export function tolkaRad(text) {
  let rad;
  try {
    rad = JSON.parse(text);
  } catch {
    return null;
  }
  if (!rad || !arText(rad.datum) || !arText(rad.pass) || !arText(rad.ts)) return null;
  const tsEpoch = Date.parse(rad.ts);
  if (!Number.isFinite(tsEpoch)) return null;

  // Kontraktsfälten renderas i passvyn, så deras typer måste stämma: ett
  // strängvärde där ett tal förväntas är inte data utan skräp — och i värsta
  // fall markup som körs på enheten. Bara kända fält kontrolleras; okända
  // behålls som de är, enligt principen ovan.
  if (rad.status) {
    if (!arText(rad.status) || !arText(rad.vecka)) return null;
  } else if (rad.pass === LOPPASS_ID) {
    // Löppass: inga setfält. Båda måtten är valfria var för sig, men en rad utan
    // något av dem säger ingenting och är inte värd att importera.
    if (rad.distans_km !== undefined && !arTal(rad.distans_km)) return null;
    if (rad.tid_min !== undefined && !arTal(rad.tid_min)) return null;
    if (rad.distans_km === undefined && rad.tid_min === undefined) return null;
  } else if (
    !arText(rad.ovning) || !arTal(rad.set) || !arTal(rad.vikt) || !arTal(rad.reps) || !arTal(rad.rir)
  ) {
    return null;
  }
  if (rad.alt_for !== undefined && !arText(rad.alt_for)) return null;
  if (rad.anteckning !== undefined && typeof rad.anteckning !== 'string') return null;

  // Lokala fält ägs av enheten och får aldrig komma utifrån — ett localId från
  // filen skulle krocka med autoIncrement-nyckeln. Övriga fält behålls som de
  // är, så ett framtida kontraktsfält från coachen överlever en återläsning.
  const ren = { ...rad };
  delete ren.localId;
  return { ...ren, synced: 1, tsEpoch };
}

// Statusrader (överhoppade pass) har sin egen bokföring i settings. Speglas de
// inte vid import erbjuder sig veckoavstämningen att emittera rader som redan
// finns i loggen.
async function aterstallVeckoposter(rader) {
  const perVecka = new Map();
  for (const rad of rader) {
    if (!rad.status || !rad.vecka) continue;
    if (!perVecka.has(rad.vecka)) perVecka.set(rad.vecka, []);
    perVecka.get(rad.vecka).push(rad.pass);
  }
  for (const [vecka, passIdn] of perVecka) await markeraEmitterade(vecka, passIdn);
}

// Hämtar alla månadsfiler och lägger in de rader som saknas lokalt.
// Kastar vid API-fel — ingenting har då skrivits, och anroparen kan försöka igen.
export async function aterlas() {
  const filer = (await listaKatalogFranApi('data/logg'))
    .filter((f) => f.type === 'file' && f.name.endsWith('.jsonl'))
    .sort((a, b) => a.name.localeCompare(b.name)); // YYYY-MM sorterar kronologiskt

  const nycklar = new Set((await allaRader()).map(dedupeNyckel));
  const nya = [];
  let hoppade = 0;

  for (const fil of filer) {
    const innehall = (await hamtaFilFranApi(fil.path))?.innehall || '';
    for (const text of innehall.split('\n')) {
      if (!text.trim()) continue;
      const rad = tolkaRad(text);
      if (!rad) {
        hoppade += 1;
        continue;
      }
      const nyckel = dedupeNyckel(rad);
      if (nycklar.has(nyckel)) continue;
      nycklar.add(nyckel); // skyddar även mot dubbletter inom samma fil
      nya.push(rad);
    }
  }

  if (nya.length) {
    nya.sort((a, b) => a.tsEpoch - b.tsEpoch);
    await addRader(nya);
    await aterstallVeckoposter(nya);
  }
  return { importerade: nya.length, hoppade, filer: filer.length };
}

// Auto-återläsning: körs vid boot och direkt efter att synk konfigurerats, men
// gör bara något på en enhet som saknar historik. Flaggan gör att en tom logg
// (ny användare, inga pass loggade än) inte kostar ett API-anrop vid varje start.
export async function aterlasVidBehov() {
  if (await getSetting(KLAR_NYCKEL)) return null;
  if (!navigator.onLine || !(await harSynkKonfig())) return null;

  const lokala = await allaRader();
  if (lokala.length > 0) {
    await setSetting(KLAR_NYCKEL, true); // enheten har redan sin historik
    return null;
  }

  const resultat = await aterlas();
  await setSetting(KLAR_NYCKEL, true);
  return resultat;
}
