// Demoläget slås på med ?demo i adressen: samma app, men med påhittad data i en
// egen databas och utan synk (se demo.js). Läses en gång när modulen laddas.
// Hash-routern ändrar bara #-delen av adressen, så frågan följer med hela besöket.
// `location` saknas i Node, där skripten i scripts/ importerar appens moduler.
export const AR_DEMO = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('demo');
