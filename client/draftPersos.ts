// Personnages du Draft (décisions d'Hugo du 03/11/2026) : toujours ceux des 4 équipes de départ + DUB
// et JAZZ (comme les règles du jeu) ; on n'ajoute que des Personnages « en plus », en touchant leur carte
// (petites cartes en ligne, comme le visuel du Draft du livret). Par défaut : ceux débloqués dans
// l'Aventure de cet appareil. Une lettre = une espèce (variants.ini) : on montre une carte par espèce.
//   Arène : un Personnage en plus n'entre que si les deux joueurs l'ont (server/classee.py).
//   Entre amis : ceux de celui qui crée la partie.

import { h, VNode } from 'snabbdom';

import { IMAGE, Nom, PERSONNAGES } from './aventure/personnages';
import { lire as lireAventure } from './aventure/progression';

export interface PersoDraft { lettre: string; nom: Nom; rang: 'champion' | 'pion' }

const p = (lettre: string, nom: Nom, rang: 'champion' | 'pion'): PersoDraft => ({ lettre, nom, rang });

/** Toujours dans le tirage (non décochables). */
export const BASE: PersoDraft[] = [
    p('x', 'KRAK', 'champion'), p('i', 'ROKK', 'champion'), p('w', 'FRANK', 'champion'),
    p('c', 'DYSKO', 'champion'), p('h', 'DUB', 'champion'), p('n', 'JAZZ', 'champion'),
    p('f', 'TAMTAM', 'pion'), p('b', 'SHASHA', 'pion'), p('l', 'BONGO', 'pion'), p('m', 'BANJO', 'pion'),
];

/** À ajouter si on veut (une carte par espèce). */
export const EN_PLUS: PersoDraft[] = [
    p('d', 'FUNK', 'champion'), p('o', 'FOLK', 'champion'), p('s', 'SALSA', 'champion'),
    p('r', 'YXEL', 'champion'), p('t', 'BOONG', 'champion'), p('y', 'BLUFF', 'champion'), p('z', 'RAY', 'champion'),
    p('a', 'ZYG', 'pion'), p('e', 'GONG', 'pion'), p('g', 'BASS', 'pion'), p('j', 'MARAKAS', 'pion'),
    p('p', 'HOP', 'pion'), p('q', 'GAMBY', 'pion'),
];

const LETTRES_EN_PLUS = new Set(EN_PLUS.map(x => x.lettre));
const CLE = 'matatak_draft_persos';

/** Lettres des Personnages débloqués dans l'Aventure de cet appareil (hors base). */
export function debloquesAventure(): string[] {
    const av = lireAventure();
    if (!av) return [];
    return [...new Set(av.recrues.map(n => PERSONNAGES[n]?.lettre).filter((l): l is string => !!l && LETTRES_EN_PLUS.has(l)))];
}

/** Les Personnages en plus choisis (lettres) : le choix gardé sur l'appareil, sinon les débloqués. */
export function persosEnPlus(): string {
    try {
        const garde = localStorage.getItem(CLE);
        if (garde !== null) return [...garde].filter(l => LETTRES_EN_PLUS.has(l)).join('');
    } catch { /* navigation privée */ }
    return debloquesAventure().join('');
}

function noter(lettres: string) {
    try { localStorage.setItem(CLE, lettres); } catch { /* navigation privée */ }
}

const IMG = '/static/images/background/collection/sombre/';

function carte(x: PersoDraft, etat: 'base' | 'pris' | 'libre', onClick?: () => void): VNode {
    return h(`button.dp-carte.${etat}`, {
        attrs: {
            type: 'button',
            title: x.nom,
            'aria-label': etat === 'base' ? `${x.nom} (toujours dans le tirage)` : x.nom,
            'aria-pressed': etat === 'base' ? 'true' : String(etat === 'pris'),
            disabled: etat === 'base',
        },
        on: onClick ? { click: onClick } : {},
    }, [h('img', { attrs: { src: IMG + IMAGE[x.nom], alt: '', loading: 'lazy', width: 72, height: 72 } })]);
}

/** Le choix des Personnages du tirage : la base (toujours là), puis les cartes à toucher. */
export function choixPersosDraft(maj: () => void, note: string): VNode {
    const pris = new Set(persosEnPlus());
    const basculer = (l: string) => {
        if (pris.has(l)) pris.delete(l); else pris.add(l);
        noter(EN_PLUS.map(x => x.lettre).filter(x => pris.has(x)).join(''));
        maj();
    };
    const rangee = (rang: 'champion' | 'pion') => h('div.dp-rangee', [
        ...BASE.filter(x => x.rang === rang).map(x => carte(x, 'base')),
        ...EN_PLUS.filter(x => x.rang === rang).map(x => carte(x, pris.has(x.lettre) ? 'pris' : 'libre', () => basculer(x.lettre))),
    ]);
    return h('div.bloc.draft-persos', [
        h('div.etiq', [h('span', 'Personnages du Draft'), h('b', pris.size ? `+ ${pris.size}` : 'Jeu de base')]),
        h('small.aide', note),
        h('div.dp-titre', 'Champions'),
        rangee('champion'),
        h('div.dp-titre', 'Pions'),
        rangee('pion'),
    ]);
}
