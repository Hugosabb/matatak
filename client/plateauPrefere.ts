// Plateau préféré, partagé par l'Aventure, « Défier un ami » et l'Arène (Hugo, 02/11/2026) : par
// défaut « Selon l'écran » (Mini sur téléphone, 8 × 8 sur ordinateur et tablette) ; choisir un plateau
// à la main coupe ce réglage, qu'on peut remettre. Clé reprise de l'Aventure (même réglage partout).

export type Plateau = 'matatak' | 'matatakmini';

const CLE_AUTO = 'matatak_aventure_plateau_auto';

export function plateauAuto(): boolean {
    try { return localStorage.getItem(CLE_AUTO) !== 'non'; } catch { return true; }
}

export function noterPlateauAuto(auto: boolean) {
    try { localStorage.setItem(CLE_AUTO, auto ? 'oui' : 'non'); } catch { /* navigation privée */ }
}

export const plateauDeLEcran = (): Plateau => (matchMedia('(max-width: 760px)').matches ? 'matatakmini' : 'matatak');
