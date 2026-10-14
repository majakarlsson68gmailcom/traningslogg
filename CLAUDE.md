# CLAUDE.md — instruktioner för Claude Code

## Vad detta är
Personligt träningsprojekt. Appen i `app/` är en mobil PWA för att logga styrkepass.
Coachning sker i Claude Code via skillen `/coach` (`.claude/skills/coach/SKILL.md`) och
lever i `coach/`. Flyttad från Claude Cowork 2026-09-03: coachen läser och skriver repot
direkt, inget manuellt led. Träningsbesluten är coachens och Majas — i kodläge ändrar
Claude Code inte träningsinnehåll (program, principer, profil, avstämningar).

**Det här är den publika kopian (portfolio).** `data/` innehåller påhittad exempeldata.
Majas riktiga logg och program, liksom coachens profil, principer och beslutslogg
(`coach/PROFIL.md`, `PRINCIPER.md`, `AVSTAMNINGAR.md`), finns bara i det privata repot.
Lägg aldrig in riktig träningsdata här.

## Läs först
- `SPEC.md` — vad som ska byggas (v1-tabellen är kravet)
- `ARCHITECTURE.md` — stack, datamodell, synklogik

## Hårda regler
1. **Ändra aldrig schemat** i `data/program.json` eller loggformatet (JSONL-fälten).
   Datakontraktet ägs av coachen. Behövs en schemaändring: stanna och fråga användaren.
2. **`data/program.json` ändras bara av `/coach`**, efter en avstämning som dokumenterats
   i `coach/AVSTAMNINGAR.md` och Majas uttryckliga ja i chatten. Appen skriver endast
   `data/logg/`. Kodläge rör varken programfilen eller träningsinnehållet i `coach/`
   (`muskelgrupper.json` och `veckostarter.json` är också coachens).
3. **Ingen backend, inga betaltjänster, inga API-anrop till AI-tjänster.**
4. **Loggflödet är heligt:** ingen funktion får öka antalet tryck för att logga ett set.
5. Bygg v1 klart innan nice-to-have påbörjas.

## Kodkvalitet
- Användaren är interaktionsdesigner med teknisk inriktning: förklara arkitekturval kort,
  håll koden läsbar och konsekvent hellre än smart.
- Mobil-först: tumvänliga tryckytor (min 44 px), fungerar i porträttläge, testa offline.
- Svenska i UI.

## Miljö
- Datan synkas till ett privat GitHub-repo via Contents API med fingranulär token (contents:write, endast datarepot).
- Token lagras lokalt på enheten (localStorage är ok för detta ändamål), aldrig i koden/repot.
- Hosting: GitHub Pages eller Vercel free tier.
- **Service worker-cachen bumpas automatiskt.** `.githooks/pre-commit` kör
  `scripts/bump-sw-cache.mjs`, som höjer `CACHE` i `app/sw.js` när någon fil i
  `SKAL` är stagad. Bumpa inte för hand — hooken hoppar över om det redan är gjort.
  På en ny maskin: `git config core.hooksPath .githooks`.
