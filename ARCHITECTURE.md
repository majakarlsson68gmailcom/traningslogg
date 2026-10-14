# ARCHITECTURE

## Översikt
```
              GitHub-repo  ◀──läser/skriver── [PWA på mobil]
             (sanningskälla)      automatiskt, Contents API
               ▲        │
   committar   │        │  program.json (coach äger innehållet, app läser)
   program.json│        │  logg/*.jsonl  (app skriver)
               │        ▼
        [Claude Code: /coach] ── läser logg + program, kör veckorapport
               │                  skriver program.json och coach/ efter Majas ja
               └── Maja i chatten: avstämning, beslut
```
Repo:t är enda sanningskällan. Ingen backend/databas — beslut 2026-07-24, se nedan.

Alla led är automatiska. Coachen är skillen `/coach` (`.claude/skills/coach/SKILL.md`)
och läser repot direkt: `data/logg/`, `data/program.json` och `coach/`. Sammanställningen
görs av `scripts/veckorapport.mjs`, som återanvänder appens veckomodell (`app/js/format.js`)
så att coachen bokför exakt de veckor appen gör. Programändringar skrivs av coachen själv,
efter en post i `coach/AVSTAMNINGAR.md` och Majas uttryckliga ja — validatorn och CI:n
fångar en trasig fil. Se beslutsraden 2026-09-03.

Fram till 2026-09-03 bodde coachen i ett Cowork-projekt utan åtkomst till repot: loggen
laddades upp manuellt vid månadsskifte och programändringar kom tillbaka som förslag.
Historiken finns i beslutsraderna 2026-07-29 och 2026-08-05.

## Stack (förslag — Claude Code får välja inom ramarna)
- PWA: installerbar, offline-first, service worker
- Ramverk: valfritt lättviktigt (vanilla/Preact/Svelte). Ingen tung state-hantering.
- Lokal lagring: IndexedDB
- Synk: GitHub Contents API med fingranulär token (endast detta repo, endast contents:write)
- Hosting: Vercel free tier — **produktion: https://traningsprojekt.vercel.app**, byggd från `main`.
  `vercel.json` publicerar bara `app/` (`outputDirectory`), så `data/` ligger inte på sajten:
  appen hämtar `program.json` via Contents API och behöver därför en token på en ny enhet.
  Service workern är cache-first, så efter en deploy krävs en omladdning eller två innan nytt
  skal slår igenom — Inställningar → Version visar vilken version som faktiskt körs.

## Datamodell

### `data/program.json` — ägs av coach, committas av Maja/Claude Code, läses av app
Se filen. Nyckelfält per övning: `id`, `namn`, `set`, `reps` (sträng, kan vara intervall),
`vikt` (kg, `null` = kalibrera själv, `0` = kroppsvikt), `rir_mal`, `vila_sek`,
`alternativ` (lista med övnings-id), `kommentar` (valfri).

I **loggen** kan `vikt` dessutom vara negativ: assisterande vikt, där `-10` betyder 10 kg
assistans (band/maskin). Programfilen använder aldrig negativa vikter — konventionen finns
för övningar som loggas via byte (`pullups_assist`) och vikten anges då för hand. Se
beslutsraden 2026-08-07. Konventionen står i coachens skill (`.claude/skills/coach/SKILL.md`).

I roten finns dessutom `ovningsnamn` — en karta `id` → visningsnamn för övningar som bara
förekommer som alternativ och därför saknar eget övningsobjekt. Se namnuppslaget nedan.

**Övningsbyte är begränsat till `alternativ`.** Appen har ingen fri inmatning av övningar —
bytesmenyn visar exakt de id:n som står i slotets `alternativ`, inget annat (`views/pass.js:182`).
En övning som varken har ett eget slot eller förekommer i någon `alternativ`-lista går därför
inte att logga via appen alls. Ska en övning kunna köras måste den in i programfilen först;
det är coachens beslut, men konsekvensen är appens.

Vid byte ärver övningen slotets `set`, `reps`, `rir_mal` och `vila_sek` — bara namnet och det
loggade `ovning`-id:t ändras, och vikten behandlas alltid som okalibrerad oavsett vad slotet
säger.

**Namnuppslag i tre steg** (`namnForOvning`, `views/pass.js:72`): övningens eget objekt →
rotens `ovningsnamn`-karta → id:t med understreck utbytta mot mellanslag. Ett id som bara
förekommer i en `alternativ`-lista behöver alltså ingen egen definition, men det bör ha en
post i `ovningsnamn` — sista steget kan inte återskapa svenska tecken, så `hangande_benlyft`
blir "Hangande benlyft". Definitionen vinner över katalogen, så en katalogpost kan aldrig
tyst döpa om en övning som redan har ett namn i sitt slot. Validatorn varnar både för
alternativ-id som faller igenom till sista steget och för katalogposter ingen refererar
(en felstavad nyckel gör annars ingenting, tyst).

### `coach/` — coachens filer
`PRINCIPER.md`, `PROFIL.md` och `AVSTAMNINGAR.md` är innehållet; `muskelgrupper.json`
(fraktionell setberäkning per övning) och `veckostarter.json` (manuella veckostarter, som
annars bara finns på telefonen) är underlag för `scripts/veckorapport.mjs`. Allt ägs av
coachen och ändras bara i coachrollen.

### `data/logg/YYYY-MM.jsonl` — skrivs av app, läses av coach
En JSON-rad per loggat set, append-only:
```json
{"datum":"2026-08-03","pass":"upper1","ovning":"hantelbankpress","set":2,"vikt":16,"reps":8,"rir":2,"ts":"2026-08-03T17:42:11+02:00"}
```
Valfria fält: `alt_for` (övnings-id som ersattes), `anteckning` (endast på passets sista rad).

Löppass (egen radtyp, inga setfält):
```json
{"datum":"2026-09-20","pass":"lopning","distans_km":4.2,"tid_min":28,"ts":"2026-09-20T18:12:05+02:00"}
```
`distans_km` och `tid_min` är valfria var för sig men minst ett måste finnas — en runda som
bara tidtagits ska inte bokföras som 0 km, och en rad utan något mått säger ingenting.
`lopning` är inget pass i programmets `pass`-lista: det har inga övningar och ingen passvy,
men bokförs med samma radformat. Id:t ligger som `LOPPASS_ID` i `app/js/format.js`.

Överhoppat pass (statusrad, en per pass och vecka):
```json
{"datum":"2026-08-09","pass":"lower2","status":"ej_genomfort","vecka":"2026-W32","ts":"2026-08-10T08:12:04+02:00"}
```
`datum` är veckans sista dag (raden hamnar kronologiskt bland veckans set och i rätt månadsfil),
`vecka` identifierar veckan raden gäller. Inga setfält. Skrivs alltid efter att veckan är slut.
Ett pass med loggade set får aldrig en statusrad — set vinner över en markering.

`vecka` har två former, båda härledda ur veckans **startdag**: en kalendervecka som börjar på en
måndag får ISO-veckan (`2026-W32`) som förut, och en vecka som förskjutits av ett manuellt avslut
får sitt startdatum (`2026-08-23`). Eftersom varje vecka snäpper tillbaka till kalendern uppstår
den andra formen bara för de veckor som faktiskt förskjutits — all befintlig historik behåller
sin ISO-nyckel och roundtrippar oförändrad genom återläsningen.

Två begränsningar värda att känna till: bara *föregående* vecka stäms av vid veckoskiftet, och
en vecka helt utan aktivitet (appen aldrig öppnad) får inga rader alls — luckan i loggen är
signalen. Markeringar i pågående vecka lever bara på enheten (IndexedDB `settings`,
`vecka:<veckonyckel>`) och skrivs till loggen först vid veckoskiftet, så de kan ångras fritt.

Veckans gränser: en vecka löper från sin startdag till första söndagen efter den, eller till den
dag den avslutas manuellt. Manuella veckostarter ligger i `settings` under `veckostarter`
(en sorterad lista med datum); är listan tom är varje vecka en vanlig ISO-vecka.

### Härlett (lagras ej)
- Passlängd: sista ts − första ts per datum+pass
- PB: flest reps på samma vikt **eller tyngre**, bland set som höll mål-RIR
  (`js/pb.js`). Se beslutsraden 2026-08-07.
- e1RM (framtida): Epley på loggdata

## Synklogik
1. Allt skrivs först till IndexedDB (offline-first)
2. Vid nät: osynkade rader appendas till aktuell månadsfil via Contents API
3. Append-only ⇒ inga merge-konflikter. Vid krock (samtidig commit): hämta, appenda om, försök igen
4. Synkstatus visas diskret i UI (antal osynkade rader)

## Återläsning (`js/aterlasning.js`)
Motsatt riktning: repot → IndexedDB. Utan den är repot en säker backup men inte en
källa — en ny telefon eller rensad webbläsardata ger en tom app trots att datan finns i git,
eftersom "Senast:", PB och veckoraden alla byggs ur IndexedDB.

Listar `data/logg/`, hämtar varje `.jsonl`, och lägger in de rader som saknas lokalt.
Importerade rader får `synced=1` — de ligger redan i repot och skickas aldrig tillbaka.
Dedupe sker på samma nyckel som synken (`ts|pass|ovning|set|status`), så en import kan köras
om utan att skapa dubbletter. Rader utan giltig `ts` hoppas över: `tsEpoch` driver
`ovning_tid`-indexet och all sortering.

Statusrader speglas till veckostatus-bokföringen (`vecka:<ISO-vecka>` → `emitterade`).
Annars ser veckoavstämningen ett pass som redan har en statusrad i repot som ologgat och
erbjuder sig att skriva en till — en dubblett som append-only inte tillåter oss att ta bort.

Körs automatiskt vid boot och direkt efter att synk konfigurerats, men bara när `sets`-storen
är tom. En flagga i `settings` (`aterlasning:klar`) gör att en ny användare utan loggade pass
inte kostar ett API-anrop vid varje start. Manuell knapp finns i Inställningar → Historik.

## Demoläge (`js/demo.js`)
Finns bara i den publika kopian. `?demo` i adressen ger appen med påhittad data: programmet
i `app/demo/program.json` och en logg på sex veckor i `app/demo/logg.jsonl`, båda byggda av
`scripts/bygg-demo.mjs` ur `data/program.json`. Filerna ligger under `app/` eftersom bara den
mappen publiceras.

- **Egen databas.** `db.js` öppnar `traningslogg-demo` i stället för `traningslogg` när
  `AR_DEMO` (`js/lage.js`) är satt. Demon och riktig användning kan alltså dela origin utan att
  någon rad hamnar i fel historik.
- **Ingen synk.** `harSynkKonfig()` svarar alltid nej i demon. Synk, återläsning och
  programhämtning frågar alla där först, så spärren finns på ett ställe.
- **Datum som följer med.** Loggen har fasta datum och flyttas hela veckor vid första
  inläsningen, så att dess sista vecka blir innevarande vecka. Rader från i dag och framåt
  hoppas över. Flytten sparas i `settings` och programmets `uppdaterad` flyttas lika mycket vid
  varje laddning, annars skulle förifyllningen (nyare program slår historiken) ändra beteende
  vecka för vecka. `scripts/test-demo.mjs` låser flytten.
- **Börja om** i Inställningar raderar demons databas och läser in exempeldatan på nytt.

Utan `?demo` och utan token visar felrutan en länk till demon, så att en besökare på
startadressen inte bara möts av en ruta som ber om en token.

## Arkitekturbeslut
| Datum | Beslut | Motiv |
|---|---|---|
| 2026-10-14 | Repot är en mall: varje användare har en egen privat kopia (publika kopian) | Fler ska kunna använda appen utan att projektet får en backend (CLAUDE.md regel 3). Arkitekturen klarade det redan: appen läser repo och token ur Inställningar, så samma publicerade app fungerar mot vilken kopia som helst, och datan går direkt mellan telefonen och användarens repo. Det som var personligt var coachen. Den nämnde en person vid namn och förutsatte en ifylld profil, så skillen skrevs om för en okänd användare och fick ett startsamtal som skriver profil, första program och första posten i beslutsloggen. `coach/PROFIL.md` och `AVSTAMNINGAR.md` är tomma mallar; `PRINCIPER.md` innehåller bara allmänna principer, och personliga läggs till av coachen. Startsamtalet triggas av två markörer som mallen har och en riktig kopia inte har: `Status: mall` i profilen och `EXEMPELDATA` i programmets kommentar. Kostnaden för användaren är ett GitHub-konto, en token och Claude Code. |
| 2026-10-14 | Demoläge via `?demo`, med egen databas och utan synk (publika kopian) | Repot skulle kunna visas i en portfolio, men utan token visade den publicerade appen bara en felruta. Demon behövde visa historik, personbästa och veckorad, och de byggs alla ur IndexedDB, så exempelloggen läses in där som en återläsning. Frågeparametern valdes framför en separat deploy med byggsteg: samma publicerade app kan då både visas som demo och användas på riktigt med egen token, och projektet slipper ett byggsteg. Risken med att dela origin är att demodata blandas med riktig data. Den stängs med en egen databas, inte med att städa efteråt, och synken är spärrad i `harSynkKonfig`. Exempelloggen flyttades från `data/logg/` till `app/demo/`: bara `app/` publiceras, och den som kopierar repot för eget bruk ska börja med en tom logg. **Ingen schemaändring**: exempeldatan följer kontraktet och läses med samma `tolkaRad` som återläsningen. |
| 2026-09-20 | Löpning loggas från ett kort i passlistan, inte från en meny | Radformatet fanns i datakontraktet sedan starten och `scripts/veckorapport.mjs` läste det redan — det enda som saknades var att appen kunde skapa raden. Följden var att rapportens "0 löppass på åtta veckor" var ett **mätfel som såg ut som ett beteende**, och coachen hann bygga en bedömning på det. Placeringen är kortet och inte ⋮-menyn eller Inställningar av samma skäl: en funktion man inte ser använder man inte, och löpningen var redan osynlig i programfilen. Kortet har ingen route bakom sig (löpning har inga övningar), så knappen öppnar en sheet. Dagvalet är två knappar, i dag och i går, i stället för en datumväljare: kvällslöpningen registreras ofta dagen efter, och längre bak än så är siffrorna ändå gissningar. Fälten är `type="text"` med `inputmode`, inte `type="number"` — ett komma i ett sifferfält ger tom `value` i flera webbläsare, och komma är vad ett svenskt tangentbord erbjuder. **Ingen schemaändring** (CLAUDE.md regel 1): formatet var redan coachens, det implementerades bara. Tre ställen i kontraktslagret behövde nya grenar, och alla tre var tysta om de missades: `serialiseraRad` (annars skrivs skräp till en append-only-logg), `tolkaRad` i återläsningen (annars överlever löpningen inte en ny telefon) och den öppna session-guarden i `synkbaraRader` — ett löppass har ingen session, precis som statusraderna inte hade det, och hade blivit liggande osynkat på exakt samma sätt som buggen 2026-08-22. `genomfordaFor` filtrerar bort löprader: mängden används som signal för "appen vet inget om den här veckan", och en ensam löprunda hade annars öppnat en veckoavstämning för en vecka utan ett enda styrkepass. `scripts/test-loggrader.mjs` låser alla tre radtyperna åt båda håll, eftersom felen annars inte syns förrän coachen läser fel underlag. |
| 2026-09-03 | Coachen flyttad från Claude Cowork till Claude Code (`/coach`) | Cowork-coachen nådde inte repot (raden 2026-08-05): loggen laddades upp för hand vid månadsskifte, och programändringar kom som text som Claude Code applicerade (raden 2026-07-29). Poängen med Cowork var att nå coachen var som helst, men eftersom loggen ändå måste skickas från datorn föll det argumentet. Claude Code läser och skriver repot direkt, så hela det manuella ledet försvinner och coachen kan aldrig svara på gammal data igen. Coachen är en skill i repot (`.claude/skills/coach/SKILL.md`, byggd på Cowork-projektets instruktioner) — ett medvetet val framför att lägga rollen i CLAUDE.md, som annars laddas i varje kodsession. Konsekvens för regel 2 i CLAUDE.md: programfilen får nu skrivas, men bara av coachen, bara efter en post i beslutsloggen och Majas uttryckliga ja; validatorn och CI:n som byggdes för en skrivande coach (raden 2026-07-29) gör sitt jobb igen. Räknandet lades i `scripts/veckorapport.mjs` i stället för i coachens huvud: fraktionell volym räknades för hand 2026-07-29, och bedömningen ska inte bero på att LLM:en summerar 90 set rätt. Skriptet återanvänder `veckaFor` ur appen, så förskjutna veckor bokförs lika; manuella veckostarter finns bara på telefonen, därför speglas de i `coach/veckostarter.json`. `.gitignore` öppnades för `.claude/skills/` (lokala inställningar hålls fortsatt ute). Raderna 2026-07-29 (förslag i stället för penna) och 2026-08-05 (uppladdade filer) beskriver det gamla läget och står kvar som historik. |
| 2026-08-23 | Appen visar vilket skal den kör, och kan tvinga fram en uppdatering | Efter en deploy syntes en ny knapp inte på Majas dator, och det gick inte att avgöra varför: service workern är cache-first, så en gammal version beter sig precis som en ny — den är bara gammal. Appen visade ingenstans vad den körde, och diagnosen blev gissningar i flera vändor mellan stale deploy och stale cache. Inställningarna har därför en Version-sektion som visar cachenamnet (`shell-vN` ur `app/sw.js`, samma konstant som pre-commit-hooken redan bumpar — ingen ny versionshantering infördes) och om sidan alls kontrolleras av en service worker; en okontrollerad sida hämtar allt från nätet och beter sig helt annorlunda, vilket är värt att kunna se. Ligger flera `shell-`-cachar kvar visas alla, för då pågår en uppdatering. Knappen "Hämta senaste versionen" kör `registration.update()` och **väntar in att den nya arbetaren aktiverats** innan omladdningen — utan väntan hinner omladdningen före installationen och man får samma gamla skal igen, alltså en knapp som inte gör vad den lovar. Timeout på 5 s som sista utväg: fastnar installationen är en omladdning ändå bättre än ingenting. Utan escape-hatchen var enda vägen ur en trasig cache att avinstallera appen. |
| 2026-08-23 | Veckogränsens dag väljs av användaren; knappen döljs aldrig | Bygget dagen innan hade en knapp som bara satte gränsen till NÄSTA dag, och som dessutom göms när veckan slutar i dag — motiveringen var att en söndag tar slut ändå. Fel på båda punkterna, och de förstärkte varandra: söndagen är just den dag gränsen behöver flyttas, för annars hamnar söndagens pass i veckan som redan är fylld, och det var exakt det ursprungliga problemet. Maja öppnade appen på söndagsmorgonen och hittade ingen knapp. De två fallen är genuint olika och båda behövs: står man på morgonen och ska träna hör DAGEN till den nya veckan, medan man på kvällen efter sista passet vill att den börjar i morgon. Bekräftelserutan erbjuder därför båda, med resulterande spann utskrivna för var och en, i stället för att appen gissar. Väljs "i dag" när det redan finns loggade pass i dag flyttas de till den nya veckan — rutan säger det när det gäller. Ångrafönstret blev `grans >= idag` i stället för `idag < grans`, så det täcker båda varianterna. |
| 2026-08-22 | Ångra av veckoavslutet villkoras av synkstatus, inte av tid | Avslutet sätter en gräns som styr vilken vecka resten av träningen bokförs i, och en bekräftelseruta räcker inte som enda väg ut. Men ångra kan inte vara ovillkorligt: har avstämningen emitterat `ej_genomfort`-rader som hunnit synka ligger de i en append-only-logg, och backar vi gränsen då kan passen tränas om — veckan får både en statusrad och loggade set för samma pass, vilket är precis vad raden ovan om att set vinner över markering förbjuder. Invarianten hade brutits tyst, i coachens eget underlag. Regeln blev därför densamma som `deleteSet` redan följer: en rad som inte lämnat enheten kan ångras, en som gjort det aldrig. Utfall: ett feltryck som ångras direkt fungerar alltid; ett bekräftat "Ej genomfört" med nät på gör avslutet permanent, och knappen försvinner så fort synken gått igenom i stället för att stå kvar och erbjuda något som skulle nekas. Tidsfönstret är samma dag — inte som skydd, utan för att startskärmen ska visa exakt en knapp i taget: "Avsluta veckan" medan veckan är igång, "Ångra avslutet" när den nyss stängts. Att operationen är säker att göra i flera steg beror på att veckans nyckel inte ändras: gränsen som tas bort är NÄSTA veckas start, så bokföringen under `vecka:<nyckel>` förblir giltig hela vägen. Ångra nollställer även `hanterad`, annars kommer avstämningskortet aldrig tillbaka för en vecka vars kort avvisats. Ingen ny ren logik tillkom, så verifieringen är webbläsarbaserad: fem fall körda i Chromium, varav det viktigaste är att knappen inte erbjuds för en synkad rad. |
| 2026-08-22 | Veckan kan avslutas manuellt; veckogränsen är inte längre bunden till ISO-kalendern | Två fall som båda ledde fel: ett pass som körs på söndagen bokfördes i den vecka som redan var fullbordad i stället för att inleda nästa, och en vecka som inte blev komplett kunde inte stängas i förtid — avstämningen kom först efter veckoskiftet. En vecka löper nu från sin startdag till första söndagen efter den, eller till den dag den avslutas manuellt. Regeln är en strikt generalisering: utan manuella gränser är varje vecka exakt ISO-veckan som förut. Nästa vecka snäpper tillbaka till kalendern (ett avslut på lördag ger en 6-dagarsvecka följd av en 8-dagarsvecka, sedan mån–sön igen), vilket valdes framför en vecka som alltid är 7 dagar just för att kalendern annars glider permanent och slutar stämma med coachens ISO-veckor. **Semantikändring i datakontraktet:** `vecka`-fältet på statusrader innehåller ISO-veckan när veckan börjar på en måndag och startdatumet annars. Godkänd av Maja 2026-08-22 enligt CLAUDE.md-regel 1; coachen har inte varit inblandad, och eftersom kalenderveckor behåller sin ISO-nyckel roundtrippar all befintlig historik oförändrad. Bugg som fixades på vägen: statusrader dateras nu till avslutsdagen i stället för en passerad söndag, och fastnade då i synkens öppen session-guard — en rad daterad i dag har ingen session, så fyra markerade pass blev liggande osynkade utan att något sa ifrån. Statusrader undantas nu från guarden. Veckoraden krympte samtidigt sina dagcirklar från fasta 44 px till max 44 px, så en 8-dagarsvecka får plats utan sidscroll; cirklarna är ren status och inga tryckytor. |
| 2026-07-24 | Repo som datalager, ingen Supabase/backend | Coachen är huvudkonsument av datat och läser filer direkt. Datamängd trivial. Git ger versionshistorik gratis. Backend = två tjänster + schema + nycklar för problem som inte finns (fleranvändare, skala). Omprövas om projektet får fler användare. |
| 2026-07-24 | JSONL append-only för logg | Trivial synk utan merge-konflikter. Läsbar för både människa och LLM. |
| 2026-07-24 | All träningslogik i program.json, ej i appkod | Coachen kan ändra program utan appdeploy. |
| 2026-07-26 | Överhoppat pass blir en statusrad i loggen, inte bara en lokal markering | Coachen bedömer veckovolym och frekvens (≥2 pass/muskelgrupp/vecka). Frånvaro av set säger "inte loggat" men inte "medvetet överhoppat". Raden hålls kvar på enheten till veckan är slut, så ångra aldrig krockar med append-only. |
| 2026-07-28 | Återläsning från repot i stället för backend | Frågan var om en gratis BaaS (Supabase) vore bättre än repot. Nej: coachen är huvudkonsumenten och läser filer direkt, så repot *är* gränssnittet — en DB i mitten hade producerat filer ändå. JSONL slipper migrationer, git ger versionshistorik, och free tier-projekt som pausar vid inaktivitet är en verklig felkälla för en app man öppnar 3 ggr/vecka. Supabases anon-nyckel + RLS är genuint säkrare än token i localStorage, men bara med inloggning — en kostnad utan värde i en enanvändarapp. Det enda Supabase gett gratis var återläsningen; den är nu byggd. Ompröva vid: fler användare, webbklient som läser loggen utan att klona, eller parallell loggning från två enheter. |
| 2026-07-29 | Programändringar går via förslag, inte via coachens penna | Claude Cowork har ingen skrivåtkomst till repot — undersökt och avfärdat 2026-07-29, inte ett designval från början. Konsekvensen visade sig ändå vara rimlig: coachen levererar gammal rad, ny rad och commit-meddelande, vilket är trivialt att verifiera, och Maja ser varje programändring innan den träffar appen. Ompröva om Cowork får skrivrätt: validatorn och CI:n finns redan och gör det låg risk. |
| 2026-07-29 | Validering av program.json i tre lager | Filen skrivs för hand och är den enda appen inte klarar sig utan. Ett trasigt program kraschade inte appen men misslyckades TYST — cachen användes vidare utan att något sa ifrån, så ett inaktuellt program kunde överleva en hel kalibreringscykel. Hook fångar lokala commits, CI fångar det hooken inte ser (webbredigering, eller en maskin där `core.hooksPath` aldrig satts), varningskortet fångar resten på enheten. Validatorn blockerar bara på det appen är beroende av; okända fält ger varning, annars vore hooken ett bakvägsövertagande av coachens kontrakt. |
| 2026-07-24 | Token i klienten accepteras | Privat app, egen enhet, fingranulär token mot ett privat repo. Lärobokfel, praktisk risk försumbar. |
| 2026-08-07 | Negativ vikt i loggen = assisterande vikt | Maja klarar ~3 strikta pullups och coachen föreslog assisterade som volymkomplement; appen kunde inte uttrycka assistans alls. Majas egen konvention (−10 = 10 kg assist) visade sig vara den matematiskt rätta: PB-regelns "samma vikt eller tyngre" fungerar oförändrad eftersom −10 ≥ −15 — mindre assistans är tyngre, och kroppsvikt (0) tyngre än all assistans. Alternativet (positiv "assistvikt" på en egen övningstyp) hade krävt en inverterad PB-jämförelse och ett nytt schemafält. Programfilen använder aldrig negativa vikter (validatorn kräver fortsatt ≥ 0 där); konventionen gäller loggen, där vikten anges för hand vid byte. UI-hinder på vägen: iPhonens siffertangentbord saknar minustecken, så tecknet vänds med en ±-knapp som bara finns under viktredigering — lagd över setnumret, 44 × 44 px som redan var upptagna av något utan tryckfunktion, så loggvägen kostar oförändrat noll extra tryck. Risk att leva med: coachen läser loggen men inte repot, så konventionen måste meddelas henne manuellt — görs av Maja i coach-chatten. `pullups_assist` tillagd som alternativ på båda pullups-slotten (coachens förslag, förmedlat av Maja). |
| 2026-08-07 | Ett nyare program slår historiken i förifyllningen | Upptäckt när PB-chippet byggdes: efter kalibreringen samma dag visade "Mål:" 70 kg på marklyft medan raden förifylldes med 60, och ett tryck på bocken hade loggat den gamla vikten. Fem övningar var drabbade, och RDL var värst — coachen sänkte 60 → 55 just för att 60 gav RIR 0, och appen föreslog fortsatt 60. Kalibreringen syntes alltså i UI:t men nådde aldrig datat, vilket gör hela avstämningscykeln verkningslös utan att någonting säger ifrån. Regeln: är `uppdaterad` i program.json nyare än övningens senaste loggade set förifylls programmets vikt, reps och RIR; annars vinner historiken som förut. Samma datum räknas som "redan tränat på det nya" ⇒ loggen vinner, så en kalibrering styr precis ett pass och slutar sedan lägga sig i. Bytt övning undantas — programmets vikt gäller originalövningen. `uppdaterad` fanns redan i filen, så inget nytt fält behövde införas. "Senast:"-chippet visar fortfarande den riktiga historiken: hon ska se vad hon faktiskt gjorde, även när förslaget kommer någon annanstans ifrån. |
| 2026-08-07 | PB = flest reps på samma vikt eller tyngre, bland set som höll mål-RIR | SPEC:ens formel ("vikt × reps-max") höll inte: den blir noll för pullups, plankan och hängande benlyft, som alla loggas med `vikt: 0` — och pullups är just den övning Maja har ett uttalat mål på. Den gynnar dessutom lätta högreps-set (30 kg × 20 slår 40 kg × 5 i hennes crunch-logg). "Flest reps på vikten" följer i stället dubbel progression, som är den progressionsmodell programmet faktiskt kör, och faller ut rätt för både kroppsvikt och plankans sekunder utan specialfall. Tillägget **"eller tyngre"** finns för att en lätt dag annars blir en falsk PB: utan det räcker det att vikten är ovanlig. Det ger också en kontrollerbar invariant — rekordet får aldrig stiga när vikten stiger. **RIR-kravet gäller åt båda håll** (ett grindat set varken firas eller höjer ribban), eftersom fler reps på samma vikt lättast nås genom att grinda till RIR 0 — precis det coach/PRINCIPER.md vill bort från. Utan villkoret hade appen belönat beteendet coachen försöker ändra. Konsekvens värd att känna till: övningar där alla loggade set hittills är grindade har rekord 0, så första setet som faktiskt håller mål-RIR blir ett PB. |
| 2026-08-07 | `ovningsnamn`-karta i program.json i stället för namn i appkoden | Kalibreringen v2 degraderade plankan och hängande benlyft till rena alternativ, och de tappade därmed sina namn: id-fallbacken visade "Core plankan" och "Hangande benlyft" i bytesmenyn. 18 alternativ-id hade redan samma problem, sex av dem med tappade svenska tecken — det var accepterat men inte bra. Namnen är träningsinnehåll och hör därför hemma i programfilen, inte i appen: en karta i koden hade hamnat utanför coachens kontroll och blivit fel igen vid nästa nya alternativövning. Kostnaden är ett nytt rotfält, alltså en schemaändring — godkänd av Maja 2026-08-07, och applicerad av Claude Code eftersom coachen inte kan skriva till repot (se raden 2026-07-29). Fallbacken är kvar som sista steg: en ny alternativövning ska inte kunna krascha vyn för att någon glömt katalogposten, den ska bara se lite tråkig ut och ge en varning i validatorn. |
| 2026-08-05 | Coachen läser uppladdade filer, inte repot — premissen i raderna 2026-07-24 och 2026-07-28 var fel | Coachen i Cowork-projektet svarade att den bara har `2026-07.jsonl` uppladdad och saknar åtkomst till repot. "Coachen läser filer direkt" var alltså aldrig sant, trots noteringen 2026-07-29. Konsekvens: repot är en utmärkt lagringsplats men *inte* ett gränssnitt mot coachen — det ledet är manuellt och tyst. Felet är lömskt eftersom coachen svarar självsäkert på gammal data i stället för att säga ifrån; det upptäcktes bara för att Maja frågade om två pass som fanns i repot men inte i projektet. Detta river inte beslutet att slippa backend — en Supabase hade inte heller kunnat läsas av coachen — men det river motiveringen "coachen läser filer direkt". Ompröva om GitHub-kopplingen går att slå på i coach-chatten: då försvinner hela det manuella ledet. Tills dess är det månadsskiftet som är riskpunkten, inte varje pass. |
