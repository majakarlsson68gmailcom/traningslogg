// PB (personbästa) — härleds ur loggen, lagras aldrig. Samma val som "Senast:"
// och passlängden: allt som går att räkna fram ur setraderna gör det. En rättad
// felloggning självläker därmed, och återläsningen slipper migrera något.
//
// REGELN: ett set är PB om det gör fler reps än något TIDIGARE set på samma
// vikt ELLER TYNGRE — och både setet och rekordet höll övningens mål-RIR.
//
// Två val värda att motivera, båda beslutade med Maja 2026-08-07:
//
// "eller tyngre" finns för att en lätt dag annars blir en falsk PB. Utan det
// räcker det att vikten är ovanlig: 30 kg × 20 hade slagit ett tomt rekord även
// när 35 kg × 10 redan står i loggen. Med det måste setet slå allt på vikten
// och uppåt, vilket är den enda jämförelse som betyder något.
//
// RIR-kravet gäller åt BÅDA håll. Programmet kör dubbel progression — man bygger
// reps på samma vikt — och fler reps får man lättast genom att grinda till RIR 0,
// vilket är precis det coachen vill bort från (se coach/PRINCIPER.md). Räknades
// grindade set skulle appen belöna beteendet. De ignoreras därför både som PB
// och som rekord att slå: ett utmattningsset varken firas eller höjer ribban.
//
// Kroppsvikt och tid faller ut gratis. `vikt: 0` är kroppsvikt enligt
// datakontraktet, så pullups jämförs mot andra pullups-set. Plankans sekunder
// ligger i reps-fältet och beter sig som vilket repsantal som helst.

// Statusrader (överhoppat pass) saknar setfält helt och ska aldrig räknas.
// De ligger inte i ovning_tid-indexet, men listan kan komma från annat håll.
function arSet(rad) {
  return typeof rad?.vikt === 'number'
    && typeof rad?.reps === 'number'
    && typeof rad?.rir === 'number';
}

// Högre RIR = lättare set. `rir >= rirMal` betyder alltså "stannade vid målet
// eller tidigare", dvs. lämnade minst så mycket i tanken som programmet säger.
function kvalificerat(rad, rirMal) {
  return arSet(rad) && rad.rir >= rirMal;
}

// Flest reps bland kvalificerade set på `vikt` eller tyngre. 0 = inget rekord än,
// vilket gör att första setet på en ny tung vikt blir PB — oftast just det man
// vill fira.
export function rekordFor(tidigare, vikt, rirMal) {
  let bast = 0;
  for (const rad of tidigare) {
    if (kvalificerat(rad, rirMal) && rad.vikt >= vikt) bast = Math.max(bast, rad.reps);
  }
  return bast;
}

export function arPB(rad, tidigare, rirMal) {
  if (!kvalificerat(rad, rirMal)) return false;
  return rad.reps > rekordFor(tidigare, rad.vikt, rirMal);
}

// Vilka localId i `rader` som var PB när de loggades.
//
// Varje rad jämförs bara mot rader FÖRE den i tid. Annars hade set 1 tappat sin
// markering så fort set 2 slog det, och stjärnan hoppat runt i tabellen mellan
// renderingar — ett PB är något man gjorde, inte en position i en topplista.
export function pbLocalIds(rader, rirMal) {
  const sorterade = rader.filter(arSet).sort((a, b) => a.tsEpoch - b.tsEpoch);
  const traffar = new Set();
  const tidigare = [];
  for (const rad of sorterade) {
    if (arPB(rad, tidigare, rirMal)) traffar.add(rad.localId);
    tidigare.push(rad);
  }
  return traffar;
}
