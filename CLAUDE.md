# CLAUDE.md — instruktioner för Claude Code

## Vad detta är
Ett personligt träningsprojekt. Appen i `app/` är en mobil PWA för att logga styrkepass.
Coachning sker i Claude Code via skillen `/coach` (`.claude/skills/coach/SKILL.md`) och
lever i `coach/`. Coachen läser och skriver repot direkt. Träningsbesluten är coachens och
användarens — i kodläge ändrar Claude Code inte träningsinnehåll (program, principer,
profil, avstämningar).

Repot är en mall. Ursprunget är Maja Karlssons app, och varje användare har en egen privat
kopia med sin egen data. I mallen är `data/program.json` ett påhittat exempelprogram,
`data/logg/` är tom och filerna i `coach/` är tomma mallar. Coachens startsamtal ersätter
dem. Demons påhittade data ligger i `app/demo/` och byggs med `node scripts/bygg-demo.mjs`
(se ARCHITECTURE.md, Demoläge).

## Läs först
- `SPEC.md` — vad som ska byggas (v1-tabellen är kravet)
- `ARCHITECTURE.md` — stack, datamodell, synklogik

## Hårda regler
1. **Ändra aldrig schemat** i `data/program.json` eller loggformatet (JSONL-fälten).
   Datakontraktet ägs av coachen. Behövs en schemaändring: stanna och fråga användaren.
2. **`data/program.json` ändras bara av `/coach`**, efter ett startsamtal eller en
   avstämning som dokumenterats i `coach/AVSTAMNINGAR.md` och användarens uttryckliga ja i
   chatten. Appen skriver endast `data/logg/`. Kodläge rör varken programfilen eller
   träningsinnehållet i `coach/` (`muskelgrupper.json` och `veckostarter.json` är också
   coachens).
3. **Ingen backend, inga betaltjänster, inga API-anrop till AI-tjänster.**
4. **Loggflödet är heligt:** ingen funktion får öka antalet tryck för att logga ett set.
5. Bygg v1 klart innan nice-to-have påbörjas.

## Kodkvalitet
- Förklara arkitekturval kort, håll koden läsbar och konsekvent hellre än smart.
- Mobil-först: tumvänliga tryckytor (min 44 px), fungerar i porträttläge, testa offline.
- Svenska i UI.

## Miljö
- Datan synkas till användarens privata kopia av repot via Contents API med fingranulär
  token (Contents: read and write, endast det repot).
- Token lagras lokalt på enheten (localStorage är ok för detta ändamål), aldrig i koden/repot.
- Hosting: Vercel free tier. `vercel.json` publicerar bara `app/`, så `data/` och `coach/`
  hamnar aldrig på sajten.
- **Service worker-cachen bumpas automatiskt.** `.githooks/pre-commit` kör
  `scripts/bump-sw-cache.mjs`, som höjer `CACHE` i `app/sw.js` när någon fil i
  `SKAL` är stagad. Bumpa inte för hand — hooken hoppar över om det redan är gjort.
  På en ny maskin: `git config core.hooksPath .githooks`.
