const CACHE_NAME = 'matatak-cache-v4';
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
    // Pour la page HTML, on demande toujours au réseau d'abord (Network-First) 
    // pour garantir que les utilisateurs ont la dernière version de l'application.
    if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // Pour tout le reste (Images, CSS, JS), on fait comme avant : Cache-First
    // On regarde dans le cache, si ce n'y est pas, on va sur le réseau sans rien compliquer.
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
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
