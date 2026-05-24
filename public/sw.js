const CACHE_NAME = 'blyve-v1';
const PRECACHE_URLS = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const url = new URL(request.url);

  // Only cache same-origin http(s) assets — skip chrome-extension:, blob:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const destination = request.destination;

  if (['style', 'script', 'image', 'font'].includes(destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response.ok || response.type === 'opaque') return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy).catch(() => {
              // Ignore cache write failures (unsupported schemes, quota, etc.)
            });
          });
          return response;
        });
      })
    );
  }
});
