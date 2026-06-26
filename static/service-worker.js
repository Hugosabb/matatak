const CACHE_NAME = 'matatak-cache-v3';
const URLS_TO_CACHE = [
    '/',
    '/static/site.css',
    '/static/style.css',
    '/static/favicon/favicon.ico',
];

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force activate immediately
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(URLS_TO_CACHE);
            })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // If the network request succeeds, we return it and optionally update the cache
            return networkResponse;
        }).catch(() => {
            // If the network fails (offline), we fallback to the cache
            return caches.match(event.request);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Take control of all pages immediately
    );
});
