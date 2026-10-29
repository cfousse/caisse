// Service worker : met l'application en cache pour qu'elle fonctionne sans réseau.
// Pour publier une mise à jour, changer le numéro de version ci-dessous.
const CACHE = 'caisse-v1.1.0';
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
    .then(keys => Promise.all(keys.filter(k => k.startsWith('caisse-v') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) {
    // Seul le SDK Firebase est gardé en mémoire ; les échanges avec Firestore passent directement.
    if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
      e.respondWith(caches.open(SDK_CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }))));
    }
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
