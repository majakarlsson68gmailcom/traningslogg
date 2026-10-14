// Laddstrategi för data/program.json (läses alltid, skrivs aldrig av appen):
//   1. same-origin — funkar lokalt (servern körs från repo-roten) och när hela
//      repot deployas som statisk site
//   2. GitHub Contents API — om token finns (t.ex. deploy utan data-mappen)
//   3. IndexedDB-cache — offline
// Service workern cachar medvetet INTE program.json; offline-berättelsen bor här.

import { sparaProgram, hamtaProgram } from './db.js';
import { hamtaFilFranApi, harSynkKonfig, getRepoKonfig } from './sync.js';

// Felrutan är enda diagnostiken som finns på en telefon — där går det inte att
// öppna en konsol. Därför översätts API-svaret till något som pekar ut vad man
// faktiskt ska ändra, i stället för ett generiskt "ingen anslutning".
function tolkaApiFel(fel, konfig) {
  const status = String(fel?.message || '').match(/GitHub API (\d+)/)?.[1];
  const repo = `${konfig.agare}/${konfig.repo}`;
  if (status === '401') return 'GitHub svarade 401: token är fel, ofullständig eller har gått ut. Skapa en ny och klistra in den igen.';
  if (status === '403') return `GitHub svarade 403: token saknar behörighet till ${repo}. Den behöver Contents: Read and write.`;
  if (!status) return `Kunde inte nå GitHub (${fel?.message || 'okänt fel'}). Är telefonen online?`;
  return `GitHub svarade ${status} för ${repo}.`;
}

// Ett trasigt program i repot får aldrig se ut som ett nätfel — åtgärden är en
// helt annan. Därför parsas JSON:en separat från hämtningen på båda vägarna.
const TRASIG_JSON = (fel) => `data/program.json i repot är inte giltig JSON (${fel.message}). `
  + 'Programmet behöver rättas i repot.';

// Returnerar { data, varning }. `varning` är satt när appen föll tillbaka på
// cachen trots att en källa svarade — den situationen var tyst förut, och en
// tyst fallback betyder att telefonen kan visa ett inaktuellt program hur länge
// som helst utan att någonting säger ifrån.
export async function laddaProgram() {
  let parseFel = null;

  try {
    const svar = await fetch(new URL('../../data/program.json', import.meta.url), { cache: 'no-store' });
    if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
    const text = await svar.text();
    try {
      const data = JSON.parse(text);
      await sparaProgram(data, 'origin');
      return { data, varning: null };
    } catch (fel) {
      parseFel = TRASIG_JSON(fel);
    }
  } catch {
    // nätet eller filen saknas — prova nästa källa
  }

  let anledning = parseFel;
  if (await harSynkKonfig()) {
    const konfig = await getRepoKonfig();
    try {
      const fil = await hamtaFilFranApi('data/program.json');
      if (!fil) {
        // 404. Fingranulära tokens svarar 404 även när repot finns men token
        // saknar åtkomst — därför nämns båda orsakerna.
        anledning = `Hittade inte data/program.json i ${konfig.agare}/${konfig.repo} (branch ${konfig.branch}). `
          + 'Antingen är repo-namnet fel, eller så gäller token inte det repot.';
      } else {
        try {
          const data = JSON.parse(fil.innehall);
          await sparaProgram(data, 'api');
          return { data, varning: null };
        } catch (fel) {
          anledning = TRASIG_JSON(fel);
        }
      }
    } catch (fel) {
      anledning = tolkaApiFel(fel, konfig);
    }
  } else if (!anledning) {
    anledning = 'Repo och token saknas. Fyll i dem under Inställningar.';
  }

  const cachad = await hamtaProgram();
  if (cachad) return { data: cachad, varning: anledning };

  throw new Error(anledning || 'Ingen anslutning och inget cachat program. Anslut till nätet en gång först.');
}
