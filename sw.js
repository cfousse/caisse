/* Service worker : l'appli fonctionne sans réseau. Changez le numéro de CACHE à chaque mise à jour. */
const CACHE = 'caisse-v1.1.5';
const SDK_CACHE = 'caisse-sdk'; // SDK Firebase (version figée dans l'adresse), conservé d'une version à l'autre
const FILES = ['./', './index.html', './style.css', './app.js', './sync.js', './sync-firebase.js', './firebase-config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SDK_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
    // Seul le SDK Firebase est gardé en mémoire ; le reste (Firestore, authentification) passe directement.
    if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
      e.respondWith(caches.open(SDK_CACHE).then(c => c.match(e.request).then(r => r || fetch(e.request).then(resp => {
        if (resp.ok) c.put(e.request, resp.clone());
        return resp;
      }))));
    }
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
