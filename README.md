# Träningslogg

En mobilapp (PWA) för att logga styrkepass mellan seten. Jag byggde den för min egen träning och har loggat mina pass i den sedan juli 2026. Appen fungerar offline, har ingen backend och sparar all data som textfiler i ett GitHub-repo.

> All träningsdata i det här repot är påhittad exempeldata. Min riktiga logg och mitt program ligger i ett separat privat repo.

| | |
|---|---|
| Roll | Interaktionsdesign och utveckling, soloprojekt |
| Tid | Juli 2026 och pågående |
| Teknik | Vanilla JavaScript (ES-moduler), IndexedDB, service worker, GitHub Contents API, Node.js-skript, GitHub Actions, Vercel |
| Storlek | Cirka 3 000 rader JavaScript, inga npm-beroenden |

## Problemet

Appen används med en hand, mellan seten, där det finns ungefär 60–90 sekunder. Varje extra steg i loggningen tar tid från vilan, och det som tar tid blir lätt överhoppat. Utan en komplett logg går det inte att se om vikterna faktiskt ökar.

Därför blev projektets viktigaste regel att ingen funktion får öka antalet tryck för att logga ett set.

## Designbeslut

### Ett set loggas med ett tryck

Varje set är förifyllt med vikt, reps och RIR (det vill säga hur många reps man hade kvar) från förra passet. Har programmet uppdaterats sedan dess förifylls programmets nya siffror i stället. Om värdena stämmer räcker ett tryck på bocken. Vilotimern startar automatiskt när setet är loggat, och passets längd räknas ut från första och sista setet, så det finns ingen start- eller stoppknapp.

### Personbästa som belönar rätt beteende

Den första idén var att markera rekord som högsta vikt × reps. Den formeln fungerade dåligt mot riktig data. Kroppsviktsövningar som pull ups får alltid värdet noll, och lätta set med många reps slår tunga set. Regeln blev i stället flest reps på samma vikt eller tyngre, bland set som höll målet för RIR. Ett set där man gått närmare gränsen än planerat räknas alltså inte, vilket gör att appen inte belönar det beteende programmet försöker få bort. Resonemanget finns i [designdokumentet](docs/superpowers/specs/2026-08-07-pb-markering-design.md).

### Repot är databasen

Appen har ingen server och ingen databas. Varje loggat set blir en rad i en textfil (JSONL) som appen lägger till i repot via GitHubs API. Filerna ändras aldrig i efterhand, bara utökas, vilket gör att synken aldrig behöver slå ihop ändringar. Git ger dessutom versionshistorik utan extra arbete.

Jag övervägde Supabase. Däremot hade en databas bara flyttat datan ett steg längre bort från den som läser den mest, det vill säga coachen (se nedan), som läser filerna direkt. Beslutet och när det bör omprövas står i [ARCHITECTURE.md](ARCHITECTURE.md).

### Offline först

Allt sparas först i telefonen (IndexedDB) och skickas till repot när det finns nät, vilket gör att loggningen aldrig väntar på nätverket. En statusrad visar hur många set som inte har synkats än.

## Arkitektur

```
            GitHub-repo  ◀── läser och skriver ── [PWA i mobilen]
           (all data)          automatiskt         offline först
                ▲
                │  läser loggen, skriver programmet efter mitt ja
                │
     [Claude Code: /coach]  ◀── avstämning i chatten ── jag
```

Appen läser träningsprogrammet från `data/program.json` och skriver loggen till `data/logg/`. Coachningen sker utanför appen, i Claude Code. Coachen är en skill (`.claude/skills/coach/SKILL.md`) som läser loggen, kör `scripts/veckorapport.mjs` och föreslår ändringar i programmet. Ingenting skrivs till programfilen förrän jag har sagt ja, och varje beslut dokumenteras i en beslutslogg.

Skriptet sköter räknandet så att coachen kan fokusera på bedömningen. Det återanvänder appens egen veckomodell, vilket gör att rapporten och appen alltid räknar veckorna på samma sätt.

## Kvalitet

Programfilen skrivs för hand, och ett fel i den syns inte direkt eftersom appen faller tillbaka på en cachad version. Därför kontrolleras filen i tre lager, det vill säga en git-hook före varje commit, GitHub Actions efter varje push och ett varningskort i appen.

Den rena logiken har tester, det vill säga regeln för personbästa, veckomodellen och formatet på loggraderna. Resten av appen är gränssnitt och lagring i webbläsaren och testas där. Sajten skickas med en strikt Content Security Policy som bara tillåter nätverksanrop till den egna domänen och GitHubs API.

## Köra lokalt

Appen kräver ingen byggprocess. Starta en statisk server i repots rot:

```bash
python3 -m http.server 8123
```

Öppna sedan `http://localhost:8123/app/`. Appen läser exempelprogrammet direkt från `data/`, och set som loggas sparas i webbläsaren. Synk till ett eget repo kräver en fingranulär GitHub-token med skrivrätt till det repot och ställs in under Inställningar.

Testerna och veckorapporten körs med Node.js 24:

```bash
node scripts/test-pb.mjs && node scripts/test-vecka.mjs && node scripts/test-loggrader.mjs
```

```bash
node scripts/veckorapport.mjs --till 2026-10-11 --veckor 6
```

## Dokumentation

- [SPEC.md](SPEC.md) beskriver kraven och vad som medvetet valts bort.
- [ARCHITECTURE.md](ARCHITECTURE.md) beskriver datamodellen, synken och alla arkitekturbeslut med motivering.
- [CLAUDE.md](CLAUDE.md) innehåller reglerna Claude Code följer i projektet.

Appen är byggd med Claude Code som AI-parprogrammerare. Jag har stått för krav, interaktionsdesign och besluten i dokumentationen.

## Nästa steg

Appen är byggd för en användare. För att fler ska kunna använda den behövs inloggning, en riktig databas och ett sätt att skapa sitt eget program i appen. I dag skrivs programmet som en JSON-fil. Det är nästa projekt jag vill ta mig an.

## Licenser

Typsnittet Anton används under SIL Open Font License 1.1, se [app/fonts/OFL.txt](app/fonts/OFL.txt).
