// Synkmotor: osynkade rader (synced=0) appendas till data/logg/YYYY-MM.jsonl
// via GitHub Contents API. Append-only-kontraktet: befintligt filinnehåll rörs
// aldrig, nya rader läggs bara till på slutet.
//
// Rader som tillhör en ÖPPEN session synkas aldrig — därför kan anteckningen
// alltid fästas på passets sista rad innan den lämnar enheten, och set förblir
// redigerbara tills KLAR trycks. Sessioner med datum före idag räknas som
// stängda (tränar man förbi midnatt kan en anteckning gå förlorad — accepterad
// avvägning för enkelhetens skull).

import {
  unsyncedRows, unsyncedCount, markSynced, getSetting, setSetting,
} from './db.js';
import { setState } from './store.js';
import { todayISO, LOPPASS_ID } from './format.js';
import { AR_DEMO } from './lage.js';

const TOKEN_NYCKEL = 'traningslogg:token';

/* ---------- konfiguration ---------- */

// Token i localStorage — accepterat beslut, se CLAUDE.md/ARCHITECTURE.md.
export function getToken() {
  return localStorage.getItem(TOKEN_NYCKEL) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_NYCKEL, token);
  else localStorage.removeItem(TOKEN_NYCKEL);
}

export async function getRepoKonfig() {
  return (await getSetting('repo')) || null; // { agare, repo, branch }
}

export async function setRepoKonfig(konfig) {
  await setSetting('repo', konfig);
}

// I demoläget finns aldrig någon synk, oavsett vad som ligger i localStorage.
// Allt som pratar med GitHub (synk, återläsning, programhämtning) frågar här
// först, så spärren behövs bara på ett ställe.
export async function harSynkKonfig() {
  if (AR_DEMO) return false;
  return Boolean(getToken() && (await getRepoKonfig()));
}

/* ---------- UTF-8-säker base64 (btoa ensam kraschar på å/ä/ö) ---------- */

function utf8TillB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function b64TillUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ---------- serialisering ---------- */

// Allowlist i fast nyckelordning enligt kontraktet — lokala fält
// (localId, synced, tsEpoch) kan aldrig läcka ut i loggen.
export function serialiseraRad(rad) {
  // Statusrad (överhoppat pass) — egen radtyp, inga setfält.
  if (rad.status) {
    return JSON.stringify({
      datum: rad.datum, pass: rad.pass, status: rad.status, vecka: rad.vecka, ts: rad.ts,
    });
  }
  // Löppass — egen radtyp utan övning och setfält. Fälten skrivs bara när de
  // har ett värde: en runda som bara tidtagits ska inte bokföras som 0 km.
  if (rad.pass === LOPPASS_ID) {
    const lop = { datum: rad.datum, pass: rad.pass };
    if (rad.distans_km != null) lop.distans_km = rad.distans_km;
    if (rad.tid_min != null) lop.tid_min = rad.tid_min;
    lop.ts = rad.ts;
    return JSON.stringify(lop);
  }
  const ut = {
    datum: rad.datum,
    pass: rad.pass,
    ovning: rad.ovning,
    set: rad.set,
    vikt: rad.vikt,
    reps: rad.reps,
    rir: rad.rir,
    ts: rad.ts,
  };
  if (rad.alt_for) ut.alt_for = rad.alt_for;
  if (rad.anteckning) ut.anteckning = rad.anteckning;
  return JSON.stringify(ut);
}

// Identitet för en rad, används för dedupe mot filens innehåll. Måste skilja
// statusrader åt: flera emitteras samma sekund vid ett veckoskifte, så ts ensam
// räcker inte.
export function dedupeNyckel(rad) {
  return [rad.ts, rad.pass, rad.ovning ?? '', rad.set ?? '', rad.status ?? ''].join('|');
}

/* ---------- Contents API ---------- */

async function apiUrl(filvag) {
  const k = await getRepoKonfig();
  return `https://api.github.com/repos/${k.agare}/${k.repo}/contents/${filvag}`;
}

function apiHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: 'application/vnd.github+json',
  };
}

// Hämtar en fil ur repot. null om filen inte finns (t.ex. ny månad).
export async function hamtaFilFranApi(filvag) {
  const k = await getRepoKonfig();
  const svar = await fetch(`${await apiUrl(filvag)}?ref=${k.branch}`, { headers: apiHeaders() });
  if (svar.status === 404) return null;
  if (!svar.ok) throw new Error(`GitHub API ${svar.status} vid GET ${filvag}`);
  const json = await svar.json();
  return { innehall: b64TillUtf8(json.content), sha: json.sha };
}

// Listar en katalog i repot. Tom lista om katalogen inte finns än (inga
// loggade pass ännu). Contents API svarar med en array för kataloger — därav
// egen funktion i stället för hamtaFilFranApi, som läser json.content.
export async function listaKatalogFranApi(katalog) {
  const k = await getRepoKonfig();
  const svar = await fetch(`${await apiUrl(katalog)}?ref=${k.branch}`, { headers: apiHeaders() });
  if (svar.status === 404) return [];
  if (!svar.ok) throw new Error(`GitHub API ${svar.status} vid GET ${katalog}`);
  const json = await svar.json();
  return Array.isArray(json) ? json : [];
}

async function skrivFilTillApi(filvag, innehall, sha, meddelande) {
  const k = await getRepoKonfig();
  const body = { message: meddelande, content: utf8TillB64(innehall), branch: k.branch };
  if (sha) body.sha = sha;
  const svar = await fetch(await apiUrl(filvag), {
    method: 'PUT',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!svar.ok) throw new Error(`GitHub API ${svar.status} vid PUT ${filvag}`);
}

/* ---------- synklogik ---------- */

// Osynkade rader som får lämna enheten: allt utom rader i öppna sessioner.
async function synkbaraRader() {
  const rader = await unsyncedRows();
  const idag = todayISO();
  const oppna = new Set();
  for (const rad of rader) {
    // En statusrad skrivs just för att passet INTE genomfördes — den tillhör
    // ingen session och får aldrig hållas kvar av öppen session-guarden. Sedan
    // veckan kan avslutas manuellt kan en sådan rad vara daterad i dag.
    if (rad.status) continue;
    // Ett löppass registreras i efterhand och har ingen session — hålls den kvar
    // av guarden blir raden liggande osynkad utan att något säger ifrån, precis
    // som statusraderna gjorde före 2026-08-22.
    if (rad.pass === LOPPASS_ID) continue;
    if (rad.datum < idag) continue; // äldre sessioner räknas som stängda
    const nyckel = `${rad.datum}:${rad.pass}`;
    if (oppna.has(nyckel)) continue;
    const status = await getSetting(`session:${nyckel}`);
    if (!status || status.klar !== true) oppna.add(nyckel);
  }
  return rader
    .filter((rad) => !oppna.has(`${rad.datum}:${rad.pass}`))
    .sort((a, b) => a.tsEpoch - b.tsEpoch);
}

function commitMeddelande(rader) {
  const setRader = rader.filter((r) => !r.status && r.pass !== LOPPASS_ID);
  const statusRader = rader.filter((r) => r.status);
  const lopRader = rader.filter((r) => !r.status && r.pass === LOPPASS_ID);
  const delar = [];
  if (setRader.length) delar.push(`${setRader.length} set`);
  if (lopRader.length) delar.push(`${lopRader.length} löppass`);
  if (statusRader.length) delar.push(`${statusRader.length} ej genomfört`);
  return `logg: ${delar.join(' + ')} ${rader[0].datum}`;
}

async function synkaFil(filvag, rader, forsok = 0) {
  const befintlig = await hamtaFilFranApi(filvag);
  const innehall = befintlig ? befintlig.innehall : '';

  // Dedupe mot filens innehåll: skyddar mot dubbletter om ett tidigare PUT
  // lyckades men svaret aldrig nådde fram.
  const finnsRedan = new Set(
    innehall.split('\n').filter(Boolean).map((rad) => {
      try {
        return dedupeNyckel(JSON.parse(rad));
      } catch {
        return null;
      }
    }),
  );
  const nya = rader.filter((r) => !finnsRedan.has(dedupeNyckel(r)));

  if (nya.length > 0) {
    let nyttInnehall = innehall;
    if (nyttInnehall && !nyttInnehall.endsWith('\n')) nyttInnehall += '\n';
    nyttInnehall += nya.map(serialiseraRad).join('\n') + '\n';
    try {
      await skrivFilTillApi(filvag, nyttInnehall, befintlig?.sha, commitMeddelande(nya));
    } catch (fel) {
      // Sha-konflikt (annan commit hann före): hämta om, appenda om, försök igen.
      if (forsok < 3) return synkaFil(filvag, rader, forsok + 1);
      throw fel;
    }
  }
  await markSynced(rader.map((r) => r.localId));
}

let pagar = false;

export async function synka() {
  if (pagar) return;
  if (!navigator.onLine || !(await harSynkKonfig())) {
    await uppdateraBadge();
    return;
  }
  pagar = true;
  setState({ synkStatus: 'syncing' });
  try {
    const rader = await synkbaraRader();
    const perFil = new Map();
    for (const rad of rader) {
      const filvag = `data/logg/${rad.datum.slice(0, 7)}.jsonl`;
      if (!perFil.has(filvag)) perFil.set(filvag, []);
      perFil.get(filvag).push(rad);
    }
    for (const [filvag, filRader] of perFil) await synkaFil(filvag, filRader);
    setState({ synkStatus: 'idle' });
  } catch (fel) {
    // Ingenting destruktivt har hänt — raderna ligger kvar i kön och badgen visar det.
    console.warn('Synk misslyckades, försöker igen vid nästa trigger:', fel);
    setState({ synkStatus: 'error' });
  } finally {
    pagar = false;
    await uppdateraBadge();
  }
}

export async function uppdateraBadge() {
  setState({ osynkade: await unsyncedCount() });
}
