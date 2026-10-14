# Träningsprinciper

Principer programmet bygger på. Markering: **[belagt]** = starkt forskningsstöd,
**[sannolikt]** = rimligt stöd, **[bedömning]** = coachens avvägning.

## Datakällor
Läs alltid färsk data ur repot innan du svarar om träningen — be aldrig användaren
klistra in loggen:
- `data/logg/YYYY-MM.jsonl` för innevarande månad (plus föregående månad vid
  månadsskifte, och alltid vid veckoavstämning).
- `data/program.json` för aktuellt program.
- `node scripts/veckorapport.mjs` sammanställer loggen per vecka: pass, set mot programmet,
  progressionssignaler och fraktionella set per muskelgrupp. Setberäkningen (direkt 1,0,
  synergist 0,5) ligger i `coach/muskelgrupper.json`; manuella veckostarter i
  `coach/veckostarter.json`. Båda är coachens filer.

Rader utan `ovning` är statusrader (`"status":"ej_genomfort"`) — ett medvetet
överhoppat pass, inte ett bortglömt. Frånvaro av rader betyder "inte loggat".

## Programdesign
- **Volym och frekvens driver hypertrofi, inte splitten.** ≥2 pass/muskelgrupp/vecka,
  ca 10–20 hårda set/muskelgrupp/vecka. **[belagt]**
- Splitten väljs efter antal pass: 2–3 pass per vecka passar helkropp, 4 pass passar
  Upper/Lower. Båda ger frekvens 2 per muskel. **[bedömning]**
- Reps 5–30 bygger muskler likvärdigt nära failure; 6–12 är praktiskt för huvudlyft. **[belagt]**
- Set tas till RIR 1–3. Närhet till failure viktigare än exakt repsantal. **[belagt]**

## Progression
- Dubbel progression: nå toppen av repsintervallet på alla set vid mål-RIR → höj vikten
  (2,5 kg maskiner/stång, 1–2 kg hantlar). **[sannolikt — enkel och robust metod]**
- Set 1 till (n−1) tas vid mål-RIR; sista setet får gå till RIR 0. Går tidiga set för nära
  failure faller repsen i de följande och intervallets topp nås aldrig.
  **[sannolikt — RIR underskattas systematiskt, och repsfall inom passet är signalen]**
- **Stagnation = 4+ veckor utan höjd vikt eller fler reps** på en övning. Åtgärd: sänk
  5–10 % och bygg upp repsen mot taket igen. Volymen (antal set) ändras inte.
  **[bedömning — belastningen är problemet, inte antalet set]**
- Programändringar (volym, övningsval, upplägg) beslutas vid avstämning, inte ad hoc.
  **[bedömning — skydd mot inkonsistens]**

## Återstart efter uppehåll
- Start ~85–90 % av tidigare arbetsvikter, tillbaka på ~2 veckor.
  Muskelminne gör återhämtningen snabb. **[belagt]**
- Försiktig volym på tunga flerledsövningar första veckan (sen muskelvärk). **[bedömning]**

## Kondition
- Löpning separat dag, helst inte dagen före benpass. Interferenseffekt liten men mätbar
  vid samtidig träning. **[belagt]**
- Start: 1 pass/vecka, lätt tempo, 20–30 min. Öka längd före tempo. **[belagt — 10 %-regel ungefärlig]**

## Avstämning
- Progression bedöms på 3–6 veckors trend, inte enskilda pass. **[belagt]**
- Deload läggs in vid behov (stagnation + hög upplevd trötthet), inte på fast schema.
  **[sannolikt — individanpassat slår kalenderstyrt]**

## Personliga principer
Läggs till av coachen när användarens mål kräver det, till exempel ett styrkemål på en
viss övning. Tomt tills dess.
