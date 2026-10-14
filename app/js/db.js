// All IndexedDB-åtkomst. Tre stores:
//   sets     — loggade set; är samtidigt synk-kön (synced=0 → osynkad)
//   program  — cache av data/program.json för offline
//   settings — nyckel/värde: repo-konfig, sessionstatus, anteckningsutkast, timer
//
// Kontraktsfälten i en rad ägs av coachen (se ARCHITECTURE.md). Lokala fält
// (localId, synced, tsEpoch) får aldrig hamna i JSONL — serialiseringen i
// sync.js använder en allowlist som garanterar det.

const DB_NAMN = 'traningslogg';
let dbPromise = null;

function oppna() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAMN, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const sets = db.createObjectStore('sets', { keyPath: 'localId', autoIncrement: true });
        sets.createIndex('synced', 'synced');
        sets.createIndex('ovning_tid', ['ovning', 'tsEpoch']);
        sets.createIndex('datum', 'datum');
        db.createObjectStore('program', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function vantaPa(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(namn, mode = 'readonly') {
  const db = await oppna();
  return db.transaction(namn, mode).objectStore(namn);
}

/* ---------- sets ---------- */

export async function addSet(rad) {
  const s = await store('sets', 'readwrite');
  return vantaPa(s.add(rad));
}

export async function updateSet(localId, patch) {
  const s = await store('sets', 'readwrite');
  const rad = await vantaPa(s.get(localId));
  if (!rad) return null;
  Object.assign(rad, patch);
  await vantaPa(s.put(rad));
  return rad;
}

// Endast för osynkade rader i öppen session — synkad JSONL är append-only
// och rör vi aldrig, men en rad som inte lämnat enheten kan ångras.
export async function deleteSet(localId) {
  const s = await store('sets', 'readwrite');
  await vantaPa(s.delete(localId));
}

// Senaste loggade set för en övning, med möjlighet att hoppa över ett datum
// (exkluderaDatum = dagens session, så "Senast:" visar förra passets siffror).
export async function lastSetFor(ovningId, exkluderaDatum = null) {
  const s = await store('sets');
  const idx = s.index('ovning_tid');
  const intervall = IDBKeyRange.bound([ovningId, 0], [ovningId, Infinity]);
  return new Promise((resolve, reject) => {
    const req = idx.openCursor(intervall, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(null);
      if (exkluderaDatum && cursor.value.datum === exkluderaDatum) return cursor.continue();
      resolve(cursor.value);
    };
    req.onerror = () => reject(req.error);
  });
}

// Hela historiken för en övning, kronologiskt. Driver PB-beräkningen, som måste
// se varje set någonsin — inte bara det senaste. Statusrader saknar `ovning` och
// hamnar aldrig i det här indexet, så listan innehåller bara riktiga set.
export async function allaSetFor(ovningId) {
  const s = await store('sets');
  const idx = s.index('ovning_tid');
  return vantaPa(idx.getAll(IDBKeyRange.bound([ovningId, 0], [ovningId, Infinity])));
}

export async function rowsForDatum(datum) {
  const s = await store('sets');
  return vantaPa(s.index('datum').getAll(IDBKeyRange.only(datum)));
}

export async function allaRader() {
  const s = await store('sets');
  return vantaPa(s.getAll());
}

// Bulkinsert i EN transaktion — återläsningen kan röra hundratals rader.
export async function addRader(rader) {
  const db = await oppna();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sets', 'readwrite');
    const s = tx.objectStore('sets');
    rader.forEach((rad) => s.add(rad));
    tx.oncomplete = () => resolve(rader.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function unsyncedCount() {
  const s = await store('sets');
  return vantaPa(s.index('synced').count(IDBKeyRange.only(0)));
}

export async function unsyncedRows() {
  const s = await store('sets');
  return vantaPa(s.index('synced').getAll(IDBKeyRange.only(0)));
}

export async function markSynced(localIds) {
  const s = await store('sets', 'readwrite');
  for (const id of localIds) {
    const rad = await vantaPa(s.get(id));
    if (rad) {
      rad.synced = 1;
      await vantaPa(s.put(rad));
    }
  }
}

/* ---------- program ---------- */

export async function sparaProgram(data, kalla) {
  const s = await store('program', 'readwrite');
  await vantaPa(s.put({ id: 'current', data, kalla, hamtadTs: Date.now() }));
}

export async function hamtaProgram() {
  const s = await store('program');
  const post = await vantaPa(s.get('current'));
  return post ? post.data : null;
}

/* ---------- settings ---------- */

export async function setSetting(key, value) {
  const s = await store('settings', 'readwrite');
  await vantaPa(s.put({ key, value }));
}

export async function getSetting(key) {
  const s = await store('settings');
  const post = await vantaPa(s.get(key));
  return post ? post.value : undefined;
}
