// iOS 26, appli installée sur l'écran d'accueil : la page occupe tout l'écran (barre d'état transparente), mais
// parfois (pages courtes : Défier un ami, Arène) la fenêtre de la page est plus courte que l'écran exactement de la
// hauteur de la barre d'état ; ce qui est fixé en bas (la barre d'onglets) remonte d'autant et laisse une bande vide
// dessous (vidéo du frère d'Hugo, 19/11/2026 ; bogue de WebKit connu, sans correctif sûr).
// On ne corrige que ce cas précis : appli installée sur iPhone, en portrait, barre d'état transparente, et écart
// égal à la hauteur de la barre d'état. --mt-ecart-bas descend alors la barre (matatak-ui.css, jouer.css).
(function () {
    if (navigator.standalone !== true) return; // seulement l'appli installée sur iPhone / iPad
    const racine = document.documentElement;
    const sonde = document.createElement('div');
    sonde.style.cssText = 'position:fixed;left:0;top:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
    let ecart = -1;
    function regler() {
        if (!sonde.isConnected) document.body.appendChild(sonde);
        const haut = sonde.offsetHeight;
        const portrait = window.innerHeight > window.innerWidth;
        const ecran = Math.max(screen.width, screen.height);
        const e = ecran - window.innerHeight;
        const n = portrait && haut > 0 && e > 0 && Math.abs(e - haut) <= 2 ? e : 0;
        if (n === ecart) return;
        ecart = n;
        racine.style.setProperty('--mt-ecart-bas', n + 'px');
    }
    let attente = false;
    const plusTard = () => { if (!attente) { attente = true; requestAnimationFrame(() => { attente = false; regler(); }); } };
    if (document.body) regler(); else document.addEventListener('DOMContentLoaded', regler);
    window.addEventListener('resize', plusTard, { passive: true });
    window.addEventListener('orientationchange', plusTard, { passive: true });
    window.addEventListener('pageshow', plusTard);
    document.addEventListener('visibilitychange', plusTard);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', plusTard, { passive: true });
    // la page change de hauteur (un onglet plus court que l'autre) sans que la fenêtre ne le signale toujours
    if (window.ResizeObserver) document.addEventListener('DOMContentLoaded', () => new ResizeObserver(plusTard).observe(document.body));
})();
