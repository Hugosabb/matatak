// Service worker de Matatak.
//
// __VERSION__ est remplacé par le serveur à chaque déploiement (voir server/pwa.py) : le fichier
// change donc d'octets à chaque nouvelle version, ce qui déclenche la mise à jour dans le navigateur.
// Ne jamais modifier la ligne suivante à la main.
const VERSION = '__VERSION__';
const CACHE_NAME = 'matatak-' + VERSION;

// Pas de skipWaiting() automatique : la page décide du bon moment (jamais en pleine partie).
// Elle envoie 'SKIP_WAITING' quand c'est sans risque ou quand le joueur clique sur la bannière.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// À l'activation : supprimer les caches des versions précédentes, puis prendre la main sur les pages.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const versioned = url.origin === self.location.origin
        && url.pathname.startsWith('/static/')
        && url.searchParams.has('v');

    // Fichiers versionnés (?v=...) : l'adresse change dès que le contenu change, donc on peut les
    // garder sans risque (chargement instantané, même avec une mauvaise connexion).
    if (versioned) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(request);
                if (cached) return cached;
                const response = await fetch(request);
                if (response.ok) cache.put(request, response.clone());
                return response;
            })
        );
    }
    // Tout le reste (pages, API, images sans version, WebSocket) : le réseau, toujours à jour.
});
