// ═══════════════════════════════════════════════════════════════════════════════════════════
//  NIVEAUX DE L'AVENTURE — fichier à éditer à la main (conception : docs/AVENTURE.md)
//  Page d'édition avec les cartes : https://claude.ai/artifact/XnECw3y4FB53jQT1cJZxbZ
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//  Chaque niveau : on affronte `rival` et on gagne `recrue` après une victoire contre CHAQUE équipe
//  de `parties`, dans l'ordre (1re partie : le joueur commence ; 2e : le rival ; 3e : le joueur).
//  On ne joue jamais deux fois la même équipe. Une équipe = Champions ; Pions de l'ordinateur, sans
//  son Roi, en majuscules.
//
//  Places : 4 = 1 Champion + 2 Pions ; 5 = 1 Champion + 3 Pions (le 3e Pion sans Champion derrière) ;
//  6 = 2 Champions + 3 Pions.
//
//  Règles vérifiées par tests/aventure.test.ts (qui échoue sinon) : bon nombre de Champions et de Pions,
//  la recrue dans chaque équipe de son niveau, jamais un Personnage pas encore présenté, jamais deux fois
//  la même équipe. Un nom mal écrit est refusé à la construction du site.
//  Conseil : l'équipe d'un rival ne s'affaiblit pas d'une rencontre à l'autre.
//  Quand le rival est le Roi choisi par le joueur, l'ordinateur joue son reflet.

import type { Nom, Roi } from './personnages';

export interface EquipeOrdi {
    champions: Nom[];
    pions: Nom[];
}

export interface Niveau {
    recrue: Nom;
    rival: Roi;
    parties: EquipeOrdi[];
}

export interface Phase {
    places: 4 | 5 | 6;
    niveaux: Niveau[];
}

const e = (champions: Nom[], pions: Nom[]): EquipeOrdi => ({ champions, pions });

// ── PHASE 1 — 4 places. Tout le monde part avec la même équipe : son Roi, DYSKO, TAMTAM et SHASHA
//    (Hugo, 27/10/2026). On gagne ce qui manque des 4 équipes de départ : une recrue après 2 victoires
//    contre l'Été, l'Automne et le Printemps, puis une à chaque victoire contre l'Hiver, pour finir.
//    Chaque rival joue son équipe de départ complète (Hugo), même si on n'en recrute qu'un morceau.
export const PHASE_1: Phase = {
    places: 4,
    niveaux: [
        // D'abord le Printemps, l'équipe la plus faible : la 1re partie doit se gagner (Hugo, 27/10/2026)
        { recrue: 'BANJO', rival: 'MOJO', parties: [
            e(['DYSKO'], ['BANJO', 'BANJO']),
            e(['DYSKO'], ['BANJO', 'BANJO']),
        ] },
        { recrue: 'ROKK', rival: 'SHANS', parties: [
            e(['ROKK'], ['SHASHA', 'SHASHA']),
            e(['ROKK'], ['SHASHA', 'SHASHA']),
        ] },
        { recrue: 'KRAK', rival: 'AZAR', parties: [
            e(['KRAK'], ['TAMTAM', 'TAMTAM']),
            e(['KRAK'], ['TAMTAM', 'TAMTAM']),
        ] },
        { recrue: 'BONGO', rival: 'KARMA', parties: [
            e(['FRANK'], ['BONGO', 'BONGO']),
        ] },
        { recrue: 'FRANK', rival: 'KARMA', parties: [
            e(['FRANK'], ['BONGO', 'BONGO']),
        ] },
    ],
};

export const PHASES: Phase[] = [
    // ── PHASE 2 — 5 places : +1 Pion, sans Champion derrière lui ──
    {
        places: 5,
        niveaux: [
            { recrue: 'MARAKAS', rival: 'AZAR', parties: [
                e(['KRAK'], ['MARAKAS', 'TAMTAM', 'MARAKAS']),
                e(['KRAK'], ['TAMTAM', 'MARAKAS', 'TAMTAM']),
            ] },
            { recrue: 'GONG', rival: 'SHANS', parties: [
                e(['ROKK'], ['GONG', 'SHASHA', 'GONG']),
                e(['ROKK'], ['SHASHA', 'GONG', 'SHASHA']),
            ] },
            { recrue: 'BASS', rival: 'KARMA', parties: [
                e(['FRANK'], ['BASS', 'BONGO', 'BASS']),
                e(['FRANK'], ['BONGO', 'BASS', 'BONGO']),
            ] },
            { recrue: 'ZAG', rival: 'MOJO', parties: [
                e(['DYSKO'], ['ZAG', 'BANJO', 'ZAG']),
                e(['DYSKO'], ['BANJO', 'ZAG', 'BANJO']),
            ] },
        ],
    },
    // ── PHASE 3 — 6 places : +1 Champion ──
    {
        places: 6,
        niveaux: [
            { recrue: 'DUB', rival: 'MOJO', parties: [
                e(['DYSKO', 'DUB'], ['BANJO', 'ZAG', 'BANJO']),
                e(['DYSKO', 'DUB'], ['BANJO', 'BANJO', 'BANJO']),
            ] },
            { recrue: 'FOLK', rival: 'AZAR', parties: [
                e(['KRAK', 'FOLK'], ['TAMTAM', 'MARAKAS', 'TAMTAM']),
                e(['KRAK', 'FOLK'], ['TAMTAM', 'TAMTAM', 'TAMTAM']),
            ] },
            { recrue: 'JAZZ', rival: 'SHANS', parties: [
                e(['ROKK', 'JAZZ'], ['SHASHA', 'GONG', 'SHASHA']),
                e(['ROKK', 'JAZZ'], ['SHASHA', 'SHASHA', 'SHASHA']),
            ] },
            { recrue: 'SALSA', rival: 'MOJO', parties: [
                e(['DUB', 'SALSA'], ['BANJO', 'BANJO', 'BANJO']),
                e(['DYSKO', 'SALSA'], ['BANJO', 'BANJO', 'BANJO']),
            ] },
            { recrue: 'FUNK', rival: 'KARMA', parties: [
                e(['FRANK', 'FUNK'], ['BASS', 'BASS', 'BASS']),
                e(['FRANK', 'FUNK'], ['BONGO', 'BONGO', 'BONGO']),
            ] },
        ],
    },
    // ── PHASE 4 — extensions, 6 places ──
    {
        places: 6,
        niveaux: [
            { recrue: 'HOP', rival: 'MOJO', parties: [
                e(['DYSKO', 'SALSA'], ['HOP', 'HOP', 'HOP']),
                e(['DYSKO', 'DUB'], ['HOP', 'BANJO', 'HOP']),
                e(['DYSKO', 'SALSA'], ['BANJO', 'HOP', 'BANJO']),
            ] },
            { recrue: 'RAY', rival: 'KARMA', parties: [
                e(['FRANK', 'RAY'], ['BONGO', 'BASS', 'BONGO']),
                e(['FRANK', 'RAY'], ['BASS', 'BONGO', 'BASS']),
                e(['FUNK', 'RAY'], ['BASS', 'BASS', 'BASS']),
            ] },
            { recrue: 'GAMBY', rival: 'SHANS', parties: [
                e(['ROKK', 'JAZZ'], ['GAMBY', 'GAMBY', 'GAMBY']),
                e(['ROKK', 'JAZZ'], ['GAMBY', 'SHASHA', 'GAMBY']),
                e(['ROKK', 'JAZZ'], ['SHASHA', 'GAMBY', 'SHASHA']),
            ] },
            { recrue: 'YXEL', rival: 'AZAR', parties: [
                e(['KRAK', 'YXEL'], ['MARAKAS', 'TAMTAM', 'MARAKAS']),
                e(['KRAK', 'YXEL'], ['TAMTAM', 'MARAKAS', 'TAMTAM']),
                e(['KRAK', 'YXEL'], ['TAMTAM', 'TAMTAM', 'TAMTAM']),
            ] },
            { recrue: 'BOONG', rival: 'SHANS', parties: [
                e(['JAZZ', 'BOONG'], ['SHASHA', 'SHASHA', 'SHASHA']),
                e(['ROKK', 'BOONG'], ['SHASHA', 'GAMBY', 'SHASHA']),
                e(['ROKK', 'BOONG'], ['GAMBY', 'GAMBY', 'GAMBY']),
            ] },
            { recrue: 'BLUFF', rival: 'MOJO', parties: [
                e(['BLUFF', 'DUB'], ['BANJO', 'BANJO', 'BANJO']),
                e(['BLUFF', 'SALSA'], ['BANJO', 'HOP', 'BANJO']),
                e(['BLUFF', 'DYSKO'], ['HOP', 'HOP', 'HOP']),
            ] },
        ],
    },
];
