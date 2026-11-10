// Menu « Plus » (templates/template.html, Hugo, 10/11/2026) : toutes les pages (tutoriel, Collection,
// puzzles, palmarès, analyse, éditeur, le jeu de société, compte, « Installer l'appli »). Bouton dans la
// barre du bas du téléphone et dans l'en-tête de l'ordinateur. L'installation n'est plus proposée dans
// les écrans de jeu : seulement ici, quand elle est possible sur cet appareil.

import { installeur, ouvrirInstallation } from './installer';

export function brancherLaNavigation() {
    // Deux boutons « Plus » : l'en-tête de l'ordinateur et la barre du bas du téléphone
    const boutons = [...document.querySelectorAll<HTMLButtonElement>('.mt-plus-bouton')];
    const panneau = document.getElementById('mt-plus');
    const fond = document.querySelector<HTMLElement>('.mt-plus-fond');
    if (!boutons.length || !panneau || !fond) return;

    // Le tutoriel reprend à l'étape où on l'a laissé (comme l'ancienne page Apprendre)
    const tutoriel = panneau.querySelector<HTMLAnchorElement>('.mt-plus-tutoriel');
    if (tutoriel) {
        let etape = 0;
        try {
            if (localStorage.getItem('matatak_tutoriel') !== 'fini')
                etape = Math.min(12, Number(localStorage.getItem('matatak_tutoriel_etape')) || 0); // 13 étapes
        } catch { /* navigation privée */ }
        tutoriel.href = `/tutorial/${etape + 1}`;
    }

    const ouvrir = (oui: boolean) => {
        // Ordinateur : le panneau descend sous le bouton « Plus » de l'en-tête
        const entete = boutons.find(b => b.closest('.mt-onglets') && b.offsetParent !== null);
        if (oui && entete) {
            const r = entete.getBoundingClientRect();
            panneau.style.top = `${Math.round(r.bottom + 8)}px`;
            panneau.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 316))}px`;
        } else if (oui) {
            panneau.style.top = panneau.style.left = '';
        }
        panneau.hidden = !oui;
        fond.hidden = !oui;
        boutons.forEach(b => b.setAttribute('aria-expanded', String(oui)));
        if (oui) majInstaller();
    };
    boutons.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); ouvrir(panneau.hidden); }));
    fond.addEventListener('click', () => ouvrir(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panneau.hidden) ouvrir(false); });
    // Ordinateur : pas de fond sombre, un clic ailleurs referme
    document.addEventListener('click', e => {
        if (!panneau.hidden && !panneau.contains(e.target as Node)) ouvrir(false);
    });
    // Toucher un onglet de mode (Aventure, Ami, Arène) sur /jouer change d'onglet sur place : on referme
    document.querySelectorAll('.mt-tab a').forEach(a => a.addEventListener('click', () => ouvrir(false)));

    const ligne = panneau.querySelector<HTMLButtonElement>('.mt-plus-installer');
    const majInstaller = () => {
        const i = installeur();
        if (!ligne) return;
        // Sur ordinateur, seuls Chrome et Edge installent (invitation native) ; sur téléphone il y a
        // toujours un geste à expliquer (Partager › Sur l'écran d'accueil, menu ⋮…)
        ligne.hidden = !i || i.installee() || (!i.peutInviter() && i.plateforme().appareil === 'ordinateur');
    };
    ligne?.addEventListener('click', async () => {
        const i = installeur();
        ouvrir(false);
        if (!i) return;
        if (i.peutInviter()) {
            if (await i.inviter() === 'indisponible') ouvrirInstallation();
        } else ouvrirInstallation();
    });
    installeur()?.surChangement(majInstaller);
    majInstaller();
}
