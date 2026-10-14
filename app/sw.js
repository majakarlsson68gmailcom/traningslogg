// Service worker: precachar app-skalet (cache-first). Bumpa CACHE-versionen
// vid deploy — activate städar gamla cachar.
//
// data/program.json cachas medvetet INTE här: dess offline-strategi bor på ett
// enda ställe, js/program.js (nät → Contents API → IndexedDB). Cross-origin
// (api.github.com) rörs aldrig.

const CACHE = 'shell-v27';

const SKAL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './fonts/anton-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/lage.js',
  './js/demo.js',
  './js/store.js',
  './js/db.js',
  './js/program.js',
  './js/pb.js',
  './js/sync.js',
  './js/timer.js',
  './js/format.js',
  './js/veckostatus.js',
  './js/aterlasning.js',
  './js/dom.js',
  './js/ikoner.js',
  './js/views/valj-pass.js',
  './js/views/pass.js',
  './js/views/timer-sheet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SKAL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namn) => Promise.all(namn.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Tryck på vilonotisen ska ta upp appen igen, inte bara stänga notisen.
// Finns ett öppet fönster fokuseras det — annars öppnas appen på nytt.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((klienter) => {
      const oppen = klienter.find((k) => 'focus' in k);
      if (oppen) return oppen.focus();
      return self.clients.openWindow('./');
    }),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  const scopeVag = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopeVag)) return; // rör aldrig /data/

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((traff) => {
      if (traff) return traff;
      if (e.request.mode === 'navigate') {
        return caches.match('./').then((skal) => skal || fetch(e.request));
      }
      return fetch(e.request);
    }),
  );
});
