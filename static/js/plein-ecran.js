// Appli installée (PWA) : vrai plein écran, sans les barres du téléphone (choix d'Hugo, 23/10/2026).
// Chrome Android l'est déjà grâce au manifeste (display: fullscreen) ; Firefox Android non : on le
// demande au premier toucher de chaque page (le navigateur l'exige après un geste, et un changement de
// page en fait sortir). Sans effet sur iPhone : Apple ne le permet pas aux pages web.
(function () {
    const appli = matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches;
    const racine = document.documentElement;
    if (!appli || !document.fullscreenEnabled || !racine.requestFullscreen) return;

    function demander() {
        if (document.fullscreenElement) return;
        racine.requestFullscreen({ navigationUI: 'hide' }).catch(function () { /* refusé : on reste en appli */ });
    }
    document.addEventListener('pointerup', demander, { passive: true });
})();
