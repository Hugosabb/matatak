// Personnages jouables dans l'Aventure : lettre Fairy-Stockfish (variants.ini), rang, Force et Saison.
// Une lettre = une espèce : les 4 Suricates partagent la lettre « a ».

import type { Saison } from '../rois';

export type Roi = 'MOJO' | 'AZAR' | 'SHANS' | 'KARMA';

export type Nom =
    | 'ZYG' | 'ZWANG' | 'ZUG' | 'ZAG'
    | 'SHASHA' | 'GONG' | 'TAMTAM' | 'BASS' | 'MARAKAS' | 'BONGO' | 'BANJO' | 'HOP' | 'GAMBY'
    | 'DYSKO' | 'FUNK' | 'DUB' | 'ROKK' | 'JAZZ' | 'FOLK' | 'YXEL' | 'SALSA' | 'BOONG' | 'FRANK'
    | 'KRAK' | 'BLUFF' | 'RAY';

export interface Personnage {
    lettre: string;
    rang: 'champion' | 'pion';
    etoiles: number;
    saison: Saison;
}

export const PERSONNAGES: Record<Nom, Personnage> = {
    ZYG: { lettre: 'a', rang: 'pion', etoiles: 1, saison: 'ete' },
    ZWANG: { lettre: 'a', rang: 'pion', etoiles: 1, saison: 'automne' },
    ZUG: { lettre: 'a', rang: 'pion', etoiles: 1, saison: 'hiver' },
    ZAG: { lettre: 'a', rang: 'pion', etoiles: 1, saison: 'printemps' },
    SHASHA: { lettre: 'b', rang: 'pion', etoiles: 4, saison: 'automne' },
    GONG: { lettre: 'e', rang: 'pion', etoiles: 1, saison: 'automne' },
    TAMTAM: { lettre: 'f', rang: 'pion', etoiles: 2, saison: 'ete' },
    BASS: { lettre: 'g', rang: 'pion', etoiles: 3, saison: 'hiver' },
    MARAKAS: { lettre: 'j', rang: 'pion', etoiles: 1, saison: 'ete' },
    BONGO: { lettre: 'l', rang: 'pion', etoiles: 3, saison: 'hiver' },
    BANJO: { lettre: 'm', rang: 'pion', etoiles: 2, saison: 'printemps' },
    HOP: { lettre: 'p', rang: 'pion', etoiles: 2, saison: 'printemps' },
    GAMBY: { lettre: 'q', rang: 'pion', etoiles: 4, saison: 'automne' },
    DYSKO: { lettre: 'c', rang: 'champion', etoiles: 3, saison: 'printemps' },
    FUNK: { lettre: 'd', rang: 'champion', etoiles: 4, saison: 'hiver' },
    DUB: { lettre: 'h', rang: 'champion', etoiles: 2, saison: 'printemps' },
    ROKK: { lettre: 'i', rang: 'champion', etoiles: 3, saison: 'automne' },
    JAZZ: { lettre: 'n', rang: 'champion', etoiles: 1, saison: 'automne' },
    FOLK: { lettre: 'o', rang: 'champion', etoiles: 2, saison: 'ete' },
    YXEL: { lettre: 'r', rang: 'champion', etoiles: 1, saison: 'ete' },
    SALSA: { lettre: 's', rang: 'champion', etoiles: 2, saison: 'printemps' },
    BOONG: { lettre: 't', rang: 'champion', etoiles: 3, saison: 'automne' },
    FRANK: { lettre: 'w', rang: 'champion', etoiles: 3, saison: 'hiver' },
    KRAK: { lettre: 'x', rang: 'champion', etoiles: 4, saison: 'ete' },
    BLUFF: { lettre: 'y', rang: 'champion', etoiles: 4, saison: 'printemps' },
    RAY: { lettre: 'z', rang: 'champion', etoiles: 3, saison: 'hiver' },
};

export const SAISON_DU_ROI: Record<Roi, Saison> = {
    AZAR: 'ete', SHANS: 'automne', KARMA: 'hiver', MOJO: 'printemps',
};

// Équipes de départ du livret, dans l'ordre de Difficulté (Été 1 … Printemps 4)
// L'équipe de départ de l'Aventure, la même quel que soit le Roi choisi (Hugo, 27/10/2026) : les trois
// Personnages les plus simples, d'une Saison chacun ; ce sont aussi ceux du tutoriel
export const EQUIPE_DE_DEPART: { champions: Nom[], pions: Nom[] } = { champions: ['DYSKO'], pions: ['TAMTAM', 'SHASHA'] };

export const ROIS_DANS_L_ORDRE: Roi[] = ['AZAR', 'SHANS', 'KARMA', 'MOJO'];

// Cartes de la Collection (static/images/background/collection/{clair,sombre}/)
export const IMAGE: Record<Nom | Roi, string> = {
    AZAR: '01-azar.webp', SHANS: '02-shans.webp', KARMA: '03-karma.webp', MOJO: '04-mojo.webp',
    FUNK: '07-funk.webp', BLUFF: '09-bluff.webp', KRAK: '10-krak.webp', FRANK: '11-frank.webp', RAY: '12-ray.webp',
    DYSKO: '13-dysko.webp', FOLK: '14-folk.webp', JAZZ: '18-jazz.webp', BANJO: '19-banjo.webp', BOONG: '20-boong.webp',
    SALSA: '24-salsa.webp', YXEL: '25-yxel.webp', ROKK: '26-rokk.webp', DUB: '30-dub.webp', BASS: '31-bass.webp',
    GAMBY: '32-gamby.webp', SHASHA: '33-shasha.webp', BONGO: '34-bongo.webp', TAMTAM: '35-tamtam.webp', HOP: '36-hop.webp',
    MARAKAS: '37-marakas.webp', GONG: '38-gong.webp', ZYG: '39-zyg.webp', ZWANG: '40-zwang.webp', ZUG: '41-zug.webp',
    ZAG: '42-zag.webp',
};

// Répliques des Rois (client/rois.ts) : le Roi du joueur le guide, les autres le défient
export const REPLIQUE: Record<Roi, string> = {
    MOJO: '« Vas-y, épate-moi. »',
    AZAR: '« Pas de casse ? Pas de Mananas. »',
    SHANS: '« La chance sourit aux audacieuses. »',
    KARMA: '« La vengeance est un plat qui se mange glacé. »',
};
