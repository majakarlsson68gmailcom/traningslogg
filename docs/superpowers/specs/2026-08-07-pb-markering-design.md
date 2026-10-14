# PB-markering — design

Datum: 2026-08-07. Beslutad med Maja, byggd samma dag.

## Problemet med den ursprungliga formuleringen

SPEC v2 sa: *"PB-markering: nytt vikt × reps-max per övning → tydlig visuell
signal vid loggning."* Den formeln höll inte mot verkliga data:

- **Kroppsvikt blir noll.** `pullups`, `core_plankan` och `hangande_benlyft`
  loggas alla med `vikt: 0` enligt datakontraktet. `vikt × reps` = 0 för varje
  set, alltid. Pullups är dessutom den övning Maja har ett uttalat mål på
  (6 reps, se `coach/PRINCIPER.md`) — den som mest förtjänar en signal kunde
  aldrig få en.
- **Den gynnar lätta högreps-set.** I Majas crunch-logg slår 30 kg × 20 (=600)
  både 40 kg × 5 (=200) och 35 kg × 10 (=350). Det tyngsta setet rankas lägst.
- **Den fångar inte hur programmet faktiskt progredierar.** Upplägget kör dubbel
  progression: bygg reps på samma vikt tills toppen av intervallet nås vid
  mål-RIR, höj sedan. En PB som mäter vikt är tyst under hela repsbygget.

## Regeln

> Ett set är PB om det gör fler reps än något **tidigare** set på **samma vikt
> eller tyngre** — och både setet och rekordet höll övningens mål-RIR.

Tre delar, var för sig motiverade.

### "flest reps på vikten"

Följer dubbel progression. Varje rep som läggs till på en oförändrad vikt syns,
och när vikten höjs börjar en ny räkning. Kroppsvikt faller ut gratis: `vikt: 0`
jämförs mot andra `vikt: 0`-set, alltså pullups mot pullups. Plankans sekunder
ligger i `reps`-fältet och beter sig som vilket repsantal som helst — inget
specialfall behövs.

### "eller tyngre"

Utan tillägget blir varje lätt dag en falsk PB: det räcker att vikten är ovanlig
för att rekordet ska vara tomt. 30 kg × 9 hade firats trots att 35 kg × 10 redan
står i loggen.

Tillägget ger också en invariant som går att kontrollera: **rekordet får aldrig
stiga när vikten stiger.** Verifierat mot hela loggen (176 rader, 20 övningar) —
t.ex. `vadpress` 10 kg:15, 20 kg:15, 25 kg:13, 30 kg:10.

### RIR-kravet, åt båda håll

Fler reps på samma vikt når man lättast genom att grinda till RIR 0. Det är
precis vad coachen vill bort från (`coach/PRINCIPER.md`: set tas till RIR 1–3).
Räknades grindade set skulle appen belöna beteendet coachen försöker ändra.

Därför ignoreras set under mål-RIR **helt**: de blir varken PB eller rekord att
slå. Ett utmattningsset flyttar inte ribban.

Konsekvens värd att känna till: en övning där alla loggade set hittills är
grindade har rekord 0, så det första setet som faktiskt håller mål-RIR blir ett
PB. I Majas logg gäller det `hantelbankpress` (8/8 grindade), `latsdrag` (6/6)
och `axelpress_maskin` (3/3). Det är avsiktligt — det pekar åt rätt håll.

## Vad användaren ser

- **Toast vid loggning:** `PB · 35 kg × 11`, 2,5 s. Ligger på z-index 90, alltså
  över timer-sheeten (50) som öppnas i samma ögonblick. Utan toasten vore
  markeringen på raden dold precis när den betyder mest.
- **Stjärna på setraden:** 13 px, grön (`--gron`), absolut placerad i hörnet av
  setnumret så att kolumnbredderna inte ändras — tabellen ska inte hoppa när en
  rad blir PB. Raden får dessutom en grön kant till vänster.
- Kroppsvikt formateras som `KV` i toasten, samma som i "Senast:".

Loggflödet rörs inte: noll extra tryck, inget att avfärda.

## Var koden bor

| Fil | Ansvar |
|---|---|
| `app/js/pb.js` | Regeln som rena funktioner. Inga beroenden, inga sidoeffekter. |
| `app/js/db.js` | `allaSetFor(ovningId)` — hela historiken via `ovning_tid`-indexet. |
| `app/js/main.js` | Laddar `historikPerOvning` vid routeladdning. |
| `app/js/views/pass.js` | Ritar markören, visar toasten, speglar ändringar. |
| `scripts/test-pb.mjs` | 16 test för regeln, körs i CI. |

**PB lagras aldrig.** Den härleds ur loggen, precis som passlängden och "Senast:"
(se ARCHITECTURE.md, *Härlett*). Det ger tre saker gratis: den gäller retroaktivt
på befintlig historik, den självläker om ett felloggat set rättas, och
återläsningen från repot behöver ingen migrering.

### Kantfall som är lösta

- **Flera PB i samma pass.** Varje rad jämförs bara mot rader före den i tid. Ett
  PB är något man gjorde, inte en position i en topplista — annars hade set 1
  tappat sin stjärna så fort set 2 slog det.
- **Bytt övning mitt i ett slot.** Raderna i ett slot kan höra till olika
  övningar. PB räknas mot den övning setet faktiskt gjordes i; RIR-målet är
  slotets, precis som set och reps ärvs vid byte.
- **Bytt övning + omladdning.** Dagens rader kan höra till en övning som inte
  längre är aktiv i något slot. `main.js` laddar historik även för dem.
- **Rättad eller raderad rad.** `historikPerOvning` speglar sets-storen, så en
  ändring räknas om direkt i stället för att sitta kvar tills vyn laddas om.
- **Statusrader** (`ej_genomfort`) saknar setfält och filtreras bort. De ligger
  inte i `ovning_tid`-indexet, men regeln kontrollerar ändå.

### Medvetet inte gjort

- **Ingen toast vid redigering.** Rättar man en siffra i efterhand uppdateras
  stjärnan (den är härledd), men ingen toast visas. Toasten hör till
  loggögonblicket.
- **Inget PB-chip på kortet.** Övervägdes — hade visat rekordet att slå före
  setet. Valdes bort: chip-raden har redan Mål, Senast och ibland Ersätter och
  Kalibrera, och blir trång på 375 px.

## Verifiering

Regeln: 16 test i `scripts/test-pb.mjs`, körda i CI. Testerna kontrollerades mot
en medvetet saboterad regel (`vikt >= vikt` → `vikt === vikt`) för att bekräfta
att de faktiskt fångar fel.

I appen, mot Majas riktiga logg (176 rader inlästa i IndexedDB):

| Fall | Förväntat | Utfall |
|---|---|---|
| 35 kg × 11 @ RIR 1 loggas | toast + stjärna | `PB · 35 kg × 11`, stjärna ✓ |
| 35 kg × 10 @ RIR 1 | ingen PB (rekord 11) | ingen toast, ingen stjärna ✓ |
| 35 kg × 14 @ RIR 0 | ingen PB trots flest reps | ingen toast, ingen stjärna ✓ |
| Rätta 10 → 12 reps | stjärna dyker upp | ✓ (och försvinner vid 12 → 10) |
| Omladdning | stjärnan härleds på nytt | ✓ |
| Radera PB-raden | rekordet räknas om | ✓ 11 reps blir PB igen |
| Rekord per vikt, alla 20 övningar | aldrig stigande med vikten | ✓ |
