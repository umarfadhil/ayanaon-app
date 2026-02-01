// Bump this to force clients to fetch fresh assets after deploys
const CACHE_NAME = 'ayanaon-static-v2.4.12';
const PRECACHE_URLS = [
    './',
    './admin.css',
    './admin.html',
    './admin.js',
    './app.js',
    './auth.css',
    './auth.js',
    './favicon-v2.svg',
    './icon-192-v2.png',
    './icon-512-v2.png',
    './index.html',
    './login.html',
    './manifest.webmanifest',
    './register.html',
    './resident-auth.js',
    './resident-session.js',
    './style.css',
    './verify.html',
    './warga-login.html',
    './warga-register.html',
    
];
const PRECACHE_PATHS = new Set(
    PRECACHE_URLS.map((url) => new URL(url, self.location.href).pathname)
);

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

self.addEventListener('message', (event) => {
    if (event?.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    // Handle document navigations separately so we always try the network first.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => caches.match('./'))
        );
        return;
    }

    const requestURL = new URL(event.request.url);
    const isSameOrigin = requestURL.origin === self.location.origin;
    const isStaticAsset = isSameOrigin && PRECACHE_PATHS.has(requestURL.pathname);

    if (!isStaticAsset) {
        if (!isSameOrigin) {
            return;
        }

        // Dynamic same-origin GET requests skip the cache to avoid serving stale user data.
        event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
        return;
    }

    // Stale-while-revalidate for precached static assets.
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
