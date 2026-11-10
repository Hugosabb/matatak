// Pré-coups (Hugo, 10/11/2026 : « peut perturber la compréhension au début ») : un réglage dans le menu ⋯
// de la partie. Sans réglage choisi : désactivés pendant la phase 1 de l'Aventure (on découvre les
// règles), activés ensuite et pour qui n'a pas commencé l'Aventure.

import { lire as lireAventure, roisDebloques } from './aventure/progression';

const CLE = 'matatak_precoups';

export function preCoupsActifs(): boolean {
    try {
        const choix = localStorage.getItem(CLE);
        if (choix === 'oui' || choix === 'non') return choix === 'oui';
    } catch { /* navigation privée */ }
    const aventure = lireAventure();
    return !aventure || roisDebloques(aventure);
}

export function choisirPreCoups(oui: boolean) {
    try { localStorage.setItem(CLE, oui ? 'oui' : 'non'); } catch { /* navigation privée */ }
}
