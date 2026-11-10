// Barre du bas du téléphone en portrait (templates/template.html, Hugo, 10/11/2026) : le bouton « Plus »
// ouvre un petit panneau (Apprendre, compte, « Installer l'appli »). L'installation n'est plus proposée
// dans les écrans de jeu : seulement ici, quand elle est possible sur cet appareil.

import { installeur, ouvrirInstallation } from './installer';

export function brancherLaNavigation() {
    const bouton = document.querySelector<HTMLButtonElement>('.mt-plus-bouton');
    const panneau = document.getElementById('mt-plus');
    const fond = document.querySelector<HTMLElement>('.mt-plus-fond');
    if (!bouton || !panneau || !fond) return;

    const ouvrir = (oui: boolean) => {
        panneau.hidden = !oui;
        fond.hidden = !oui;
        bouton.setAttribute('aria-expanded', String(oui));
        if (oui) majInstaller();
    };
    bouton.addEventListener('click', () => ouvrir(panneau.hidden));
    fond.addEventListener('click', () => ouvrir(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panneau.hidden) ouvrir(false); });
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
