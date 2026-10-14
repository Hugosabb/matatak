// Enregistrement du service worker et mise à jour automatique de la PWA.
//
// Dès qu'une nouvelle version est disponible, elle est appliquée toute seule : la page se recharge
// et utilise les nouveaux fichiers. Il n'y a rien à cliquer.
(function () {
    if (!('serviceWorker' in navigator)) return;

    // Vérifier s'il existe une nouvelle version : au retour sur l'appli, puis toutes les 30 minutes.
    const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

    // Vrai dès qu'un service worker contrôle la page. À la toute première visite, il prend la main
    // sans qu'il y ait de nouvelle version : ce premier changement ne doit pas recharger la page.
    let controlled = Boolean(navigator.serviceWorker.controller);

    // Quand une nouvelle version prend la main, recharger pour utiliser les nouveaux fichiers.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!controlled) {
            controlled = true;
            return;
        }
        if (reloading) return;
        reloading = true;
        window.location.reload();
    });

    function activate(worker) {
        worker.postMessage('SKIP_WAITING');
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((registration) => {
                // Une nouvelle version déjà installée en attente (téléchargée lors d'une visite précédente).
                if (registration.waiting && navigator.serviceWorker.controller) {
                    activate(registration.waiting);
                }

                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing;
                    if (!worker) return;
                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                            activate(worker);
                        }
                    });
                });

                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) registration.update().catch(() => {});
                });
                setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_INTERVAL_MS);
            })
            .catch((error) => console.log('ServiceWorker registration failed: ', error));
    });
})();
