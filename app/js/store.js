// Minimal global state utan ramverk: ett objekt, setState(patch) + subscribe(fn).

const state = {
  route: { name: 'valj' },   // eller { name: 'pass', passId }
  program: null,             // innehållet i data/program.json (läses, ändras aldrig)
  programFel: null,
  programVarning: null,      // programmet kunde inte hämtas — cachad version visas
  vecka: null,               // { start, slut, nyckel, datumLista, etikett } för innevarande vecka
  angerbart: false,          // senaste veckoavslutet går fortfarande att ångra
  veckoLogg: {},             // datum → [passId, …] för veckoraden
  veckoMarkeringar: [],      // passId markerade "ej genomfört" denna vecka (ej emitterade)
  veckoAvstamning: null,     // förra veckans ologgade pass att bekräfta, eller null
  passMeny: null,            // passId vars ⋮-meny är öppen på startskärmen
  sessionRader: [],          // dagens loggade rader för öppet pass (sorterade på tsEpoch)
  senastePerOvning: {},      // ovningsId → senaste rad från TIDIGARE session (för "Senast:")
  historikPerOvning: {},     // ovningsId → alla loggade set någonsin (för PB); speglar sets-storen
  extraSet: {},              // ovningsId → antal set utöver programmet (kan vara negativt; endast UI-state)
  byten: {},                 // slot-övningsId → alternativ-övningsId för dagens session
  ovningsMeny: null,         // slot-övningsId vars ⋮-meny är öppen
  anteckningUtkast: '',      // passets anteckningsfält, persisteras som utkast i settings
  osynkade: 0,
  synkStatus: 'idle',        // idle | syncing | error
  timer: null,               // { endsAtEpoch, durationSek, pausadRestMs, ovningNamn, signalerad }
  timerRedigering: false,    // timer-sheeten visar −15/+15 för att ändra vilotiden
  timerMinimerad: false,     // sheeten ihopfälld till pill — timern tickar vidare
  avslutaOppen: false,        // bekräftelsen för "Avsluta veckan" är öppen
  loppassOppet: false,       // sheeten för att registrera ett löppass är öppen
  installningarOppna: false,
};

const lyssnare = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  lyssnare.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  lyssnare.add(fn);
  return () => lyssnare.delete(fn);
}
