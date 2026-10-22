// Installation de l'appli (PWA) : on garde l'invitation native du navigateur (Chrome, Edge, Samsung
// Internet sous Android et sur ordinateur) pour la proposer au bon moment, et on détecte l'appareil
// pour expliquer les gestes ailleurs (Safari sur iPhone et iPad, Firefox…).
(function () {
    let invitation = null;
    const abonnes = new Set();
    const prevenir = () => abonnes.forEach((f) => { try { f(); } catch (e) { /* rien */ } });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // on affiche notre propre bouton au lieu de la bannière du navigateur
        invitation = e;
        prevenir();
    });
    window.addEventListener('appinstalled', () => { invitation = null; prevenir(); });

    function installee() {
        return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
            || window.navigator.standalone === true;
    }

    // Appareil et navigateur, pour choisir les bonnes explications
    function plateforme() {
        const ua = navigator.userAgent;
        const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const android = /Android/.test(ua);
        let navigateur = 'autre';
        if (/SamsungBrowser/.test(ua)) navigateur = 'samsung';
        else if (/CriOS/.test(ua)) navigateur = 'chrome';
        else if (/FxiOS|Firefox/.test(ua)) navigateur = 'firefox';
        else if (/EdgiOS|Edg\//.test(ua)) navigateur = 'edge';
        else if (/Chrome/.test(ua)) navigateur = 'chrome';
        else if (/Safari/.test(ua)) navigateur = 'safari';
        const appareil = ios ? 'ios' : android ? 'android' : 'ordinateur';
        return { appareil, navigateur };
    }

    window.matatakInstaller = {
        installee,
        plateforme,
        peutInviter: () => invitation !== null,
        inviter: async () => {
            if (!invitation) return 'indisponible';
            const e = invitation;
            invitation = null;
            e.prompt();
            const choix = await e.userChoice;
            prevenir();
            return choix && choix.outcome === 'accepted' ? 'acceptee' : 'refusee';
        },
        // Prévenir quand l'invitation devient disponible (elle arrive après le chargement)
        surChangement: (f) => { abonnes.add(f); return () => abonnes.delete(f); },
    };
})();
