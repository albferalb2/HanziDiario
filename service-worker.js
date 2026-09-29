const CACHE_NAME = 'hanzi-diario-shell-v18';
const APP_SHELL = ['./', './index.html', './styles.css?v=18', './app.js?v=18', './hsk1.js?v=18', './firebase-config.js?v=18', './cloud.js?v=18', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(Promise.all([caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)), self.skipWaiting()])));
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hanzi-diario-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname.endsWith('/firebase-config.js')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).then(response => {
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match('./index.html'))));
});
