// Hjälpfunktioner för formatering och datum. Ingen app-logik här.

export function formatVikt(vikt) {
  if (vikt === null || vikt === undefined) return '';
  if (vikt === 0) return 'KV'; // kroppsvikt enligt datakontraktet
  return String(vikt).replace('.', ',');
}

// Negativ vikt = assisterande vikt (−10 = 10 kg assist, t.ex. pull ups i
// gummiband/maskin). Konventionen gör att PB-regelns "samma vikt eller tyngre"
// fungerar oförändrad: −10 ≥ −15, alltså räknas mindre assistans som tyngre,
// och kroppsvikt (0) som tyngre än all assistans.
export function parseVikt(text) {
  const t = String(text).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseHeltal(text) {
  const n = parseInt(String(text).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// "8-12", "8-12/ben", "30-60 sek" → undre gräns som startvärde
export function repsStart(repsStr) {
  const n = parseInt(repsStr, 10);
  return Number.isFinite(n) ? n : 0;
}

export function mmss(ms) {
  const neg = ms < 0;
  const s = Math.abs(Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Löppassets pass-id i loggen. Löpning är inget pass i programmets pass-lista —
// den har inga övningar och ingen passvy — men den bokförs med samma radformat,
// så id:t behövs på båda sidor om synken.
export const LOPPASS_ID = 'lopning';

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ISO med lokal tidszon, t.ex. 2026-08-03T17:42:11+02:00 — kontraktets ts-format
export function nuISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const tecken = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${todayISO(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${tecken}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

// ISO-veckonummer, t.ex. "2026-W32". Veckan tillhör det år dess torsdag ligger i.
export function isoVecka(d = new Date()) {
  const torsdag = new Date(d);
  torsdag.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const forstaTorsdagen = new Date(torsdag.getFullYear(), 0, 4);
  forstaTorsdagen.setDate(forstaTorsdagen.getDate() - ((forstaTorsdagen.getDay() + 6) % 7) + 3);
  const nr = 1 + Math.round((torsdag - forstaTorsdagen) / (7 * 86400000));
  return `${torsdag.getFullYear()}-W${String(nr).padStart(2, '0')}`;
}

const MANADER = ['jan', 'feb', 'mars', 'april', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Läsbart spann för en veckas datumlista: "3–9 aug", "29 juli–4 aug"
export function veckoEtikett(datumLista) {
  const forsta = datumLista[0].split('-').map(Number);
  const sista = datumLista[datumLista.length - 1].split('-').map(Number);
  const start = forsta[1] === sista[1] ? String(forsta[2]) : `${forsta[2]} ${MANADER[forsta[1] - 1]}`;
  return `${start}–${sista[2]} ${MANADER[sista[1] - 1]}`;
}

const VECKODAGS_BOKSTAVER = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

// Alla datumberäkningar går via lokal middag. Vid sommartidsskiften är dygnet
// 23 eller 25 timmar långt, och en Date på midnatt kan då landa på fel datum
// när man adderar dagar. Kl 12 har fyra timmars marginal åt båda håll.
function dag(datum) {
  return new Date(`${datum}T12:00`);
}

function plusDagar(datum, n) {
  const d = dag(datum);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

// Måndagen i ISO-veckan som innehåller datumet. getDay: söndag = 0.
function mandagen(datum) {
  const d = dag(datum);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayISO(d);
}

// Första söndagen STRIKT efter startdagen. Startar veckan på en måndag ger det
// den vanliga söndagen (7 dagar); startar den på en söndag hoppar den över
// samma dag och landar en vecka fram, så en vecka aldrig blir nolldagar lång.
function forstaSondagenEfter(datum) {
  return plusDagar(datum, 7 - dag(datum).getDay());
}

export function veckodagsBokstav(datum) {
  return VECKODAGS_BOKSTAVER[(dag(datum).getDay() + 6) % 7];
}

// Veckans identitet. Måndagsstart ger ISO-nyckeln som förut, så all befintlig
// historik och bokföring roundtrippar oförändrad; bara veckor som faktiskt
// förskjutits får den nya formen (startdatumet).
function veckoNyckel(start) {
  return dag(start).getDay() === 1 ? isoVecka(dag(start)) : start;
}

function slutFor(start, starter) {
  const naturligt = forstaSondagenEfter(start);
  const nasta = starter.find((s) => s > start);
  return nasta && nasta <= naturligt ? plusDagar(nasta, -1) : naturligt;
}

// Veckan som innehåller `datum`, givet användarens manuella veckostarter.
//
// En vecka löper från sin startdag till första söndagen efter den — eller till
// dagen före nästa manuella start, om veckan avslutats i förtid. Utan manuella
// starter är detta exakt ISO-veckan måndag–söndag, alltså oförändrat beteende.
export function veckaFor(datum, starter = []) {
  const sorterade = [...new Set(starter)].sort();
  const manuell = sorterade.filter((s) => s <= datum).pop();
  const start = manuell && datum <= slutFor(manuell, sorterade) ? manuell : mandagen(datum);
  const slut = slutFor(start, sorterade);

  const datumLista = [];
  for (let d = start; d <= slut; d = plusDagar(d, 1)) datumLista.push(d);

  return { start, slut, nyckel: veckoNyckel(start), datumLista, etikett: veckoEtikett(datumLista) };
}

export function foregaendeVecka(vecka, starter = []) {
  return veckaFor(plusDagar(vecka.start, -1), starter);
}

// Nästa veckas startdag om veckan avslutas i dag.
export function nastaVeckostart(idag) {
  return plusDagar(idag, 1);
}

// "Vecka 34 · 17–22 aug" för en kalendervecka, "Veckan 23–30 aug" för en
// förskjuten — den har inget meningsfullt veckonummer att visa.
export function veckoRubrik(nyckel, etikett) {
  const nr = nyckel.includes('-W') ? nyckel.split('-W')[1] : null;
  return nr ? `Vecka ${nr} · ${etikett}` : `Veckan ${etikett}`;
}

// Grov passlängdsuppskattning: varje set ≈ 45 s arbete + vilotid. Avrundas till 5 min.
export function uppskattadMin(pass) {
  const sek = pass.ovningar.reduce((summa, o) => summa + o.set * (o.vila_sek + 45), 0);
  return Math.max(5, Math.round(sek / 60 / 5) * 5);
}
