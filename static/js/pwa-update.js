// Enregistrement du service worker et mise à jour de la PWA.
//
// Règle : une nouvelle version s'applique toute seule sur les pages « calmes » (accueil, lobby…),
// mais jamais en pleine partie, puzzle, tutoriel ou analyse : le joueur voit alors une bannière
// et choisit lui-même le moment de recharger.
(function () {
    if (!('serviceWorker' in navigator)) return;

    const MESSAGES = {
        fr: { text: 'Nouvelle version disponible', button: 'Mettre à jour' },
        en: { text: 'New version available', button: 'Update' },
        es: { text: 'Nueva versión disponible', button: 'Actualizar' },
    };

    // Pages où recharger ferait perdre quelque chose au joueur.
    const BUSY_VIEWS = ['puzzle', 'tutorial', 'analysis', 'corranalysis', 'editor', 'tournament', 'invite', 'embed'];

    // Vérifier s'il existe une nouvelle version : au retour sur l'appli, puis toutes les 30 minutes.
    const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

    // Vrai dès qu'un service worker contrôle la page. À la toute première visite, il prend la main
    // sans qu'il y ait de nouvelle version : ce premier changement ne doit pas recharger la page.
    let controlled = Boolean(navigator.serviceWorker.controller);

    function isBusy() {
        const data = document.body.dataset;
        return Boolean(data.gameid) || BUSY_VIEWS.includes(data.view);
    }

    function showBanner(worker) {
        if (document.getElementById('update-banner')) return;
        const lang = (document.body.dataset.lang || 'fr').slice(0, 2);
        const messages = MESSAGES[lang] || MESSAGES.fr;

        const banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.setAttribute('role', 'status');

        const text = document.createElement('span');
        text.textContent = messages.text;

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = messages.button;
        button.addEventListener('click', () => {
            button.disabled = true;
            worker.postMessage('SKIP_WAITING');
        });

        banner.append(text, button);
        document.body.appendChild(banner);
    }

    function applyOrAsk(worker) {
        if (isBusy()) {
            showBanner(worker);
        } else {
            worker.postMessage('SKIP_WAITING');
        }
    }

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

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((registration) => {
                // Une nouvelle version déjà installée en attente (téléchargée lors d'une visite précédente).
                if (registration.waiting && navigator.serviceWorker.controller) {
                    applyOrAsk(registration.waiting);
                }

                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing;
                    if (!worker) return;
                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                            applyOrAsk(worker);
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
