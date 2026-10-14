# SPEC — Träningslogg (webbapp)

## Syfte
Mobilapp (PWA) för att logga styrkepass och visa progression. Används med ena handen,
mellan set, 60–90 sek fönster. Allt som saktar ner loggflödet är fel.

Coachning (program, justeringar, avstämningar) sker i Claude Code via `/coach` — inte i appen.
Appen renderar `data/program.json` och skriver `data/logg/YYYY-MM.jsonl`.

## Kärnfunktioner v1
| # | Funktion | Acceptanskriterium |
|---|---|---|
| 1 | Visa dagens pass | Öppna appen → välj pass → se övningar med set × reps, målvikt, RIR-mål. Max 2 tryck till loggläge. |
| 2 | Logga set | Vikt, reps, RIR per set. Förifyllt från senaste loggade set för övningen — utom när programmet uppdaterats efter det setet, då gäller coachens nya siffror (se ARCHITECTURE.md, beslut 2026-08-07). Max 3 tryck vid oförändrade värden. |
| 3 | Vilotimer | Startar automatiskt vid loggat set med `vila_sek` från programfilen. Vibration/notis vid slut. |
| 4 | Passlängd | Beräknas automatiskt: första till sista loggade set. Ingen manuell start/stopp. |
| 5 | Förra passets siffror | Vid varje övning syns senaste vikt × reps × RIR. |
| 6 | Offline-first | Loggning fungerar utan nät (IndexedDB). Synk till repo när nät finns, kö vid fel. |
| 7 | Anteckning per pass | Ett fritextfält, valfritt. |
| 8 | Hoppa över pass | ⋮ på passkortet markerar passet som ej genomfört den här veckan (ångra i samma meny). Vid veckoskifte — eller när veckan avslutas manuellt — listar appen veckans ologgade pass för bekräftelse. Statusraden hamnar i loggen först när veckan är slut. |
| 9 | Börja ny vecka | Knapp på startskärmen sätter veckogränsen — den nya veckan börjar i dag eller i morgon, användaren väljer. Nästa vecka snäpper tillbaka till kalendern. För pass som körs före veckoskiftet, och veckor som inte blir kompletta. Går att ångra samma dag, så länge inga ej genomfört-rader hunnit synkas. |

## Byggt efter v1
- PB-markering (2026-08-07). Regeln blev inte den som stod här nedan: "vikt × reps-max"
  blir noll för kroppsviktsövningar och gynnar lätta högreps-set. Gäller i stället
  **flest reps på samma vikt eller tyngre, bland set som höll mål-RIR** — se
  ARCHITECTURE.md. Signal: toast vid loggning + stjärna på setraden.
- Alternativ övning: ⋮-menyn på övningskortet visar `alternativ`-listan ur programfilen.
- Assisterande vikt (2026-08-07): negativ vikt i loggen = assistans (−10 = 10 kg assist).
  ±-knapp i viktredigeringen (iPhone-tangentbordet saknar minus). PB-regeln fungerar
  oförändrad: mindre assistans räknas som tyngre.
- Löploggning (2026-09-20): kort i passlistan → sheet med dagval (i dag / i går) och
  distans + tid. Radformatet var redan definierat i ARCHITECTURE.md och läst av
  veckorapporten — det saknade var att appen kunde skapa raden. Se ARCHITECTURE.md.

## Nice-to-have (v2 — byggs när loggvanan sitter)
- Progressionsgrafer (vikt/volym över tid per övning)
- Regelbaserat viktförslag (dubbel progression: alla set i toppen av repsintervallet vid mål-RIR → föreslå +2,5 kg / +1–2 kg hantlar)
- Dedikerad övningsbytesfunktion

## Medvetet bortvalt
- Övningsbibliotek med instruktioner/videor
- Notiser/påminnelser, gamification
- Konton/inloggning (en användare, GitHub-token räcker)
- AI-anrop från appen (coachning sker i Claude Code; API kostar pengar)

## Randvillkor
- Gratis: GitHub privat repo + gratis statisk hosting (t.ex. GitHub Pages/Vercel free)
- Dataformat ägs av coachen — appen får inte ändra schemat (se ARCHITECTURE.md)
