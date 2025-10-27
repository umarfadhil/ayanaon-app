// Bump this to force clients to fetch fresh assets after deploys
const CACHE_NAME = 'ayanaon-static-v8';
const PRECACHE_URLS = [
    './',
    './index.html',
    './login.html',
    './register.html',
    './verify.html',
    './style.css',
    './auth.css',
    './app.js',
    './auth.js',
    './favicon.svg',
    './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => Promise.resolve())
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }
    // Stale-while-revalidate: serve cache first, then update cache in background
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone)).catch(() => {});
                    return response;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
