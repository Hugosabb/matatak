// La route de l'Aventure pour un Roi de départ, et les positions de départ de ses parties.

import { PHASE_1, PHASES } from './niveaux';
import { EQUIPE_DE_DEPART, Nom, PERSONNAGES, Roi } from './personnages';

export type Plateau = 'matatak' | 'matatakmini';

export interface Equipe {
    champions: Nom[];
    pions: Nom[];
}

export interface Etape {
    phase: number; // 1 à 4
    places: 4 | 5 | 6;
    recrue: Nom;
    rival: Roi;
    reflet: boolean; // le rival est le Roi du joueur
    equipes: Equipe[]; // une équipe de l'ordinateur (sans son Roi) par partie : autant que de victoires à gagner
}

/** Nombre de Champions et de Pions pour 4, 5 (+1 Pion) ou 6 places (+1 Champion). */
export function composition(places: number): { champions: number, pions: number } {
    return places === 4 ? { champions: 1, pions: 2 } : places === 5 ? { champions: 1, pions: 3 } : { champions: 2, pions: 3 };
}

export function equipeDeDepart(): Equipe {
    return { champions: [...EQUIPE_DE_DEPART.champions], pions: [...EQUIPE_DE_DEPART.pions] };
}

/** Toutes les étapes, dans l'ordre : phase 1 (niveaux.ts PHASE_1), puis les suivantes. Quand le rival est
 *  le Roi du joueur, l'ordinateur joue son reflet. */
export function route(roi: Roi): Etape[] {
    return [PHASE_1, ...PHASES].flatMap((phase, i) => phase.niveaux.map(niveau => ({
        phase: i + 1,
        places: phase.places,
        recrue: niveau.recrue,
        rival: niveau.rival,
        reflet: niveau.rival === roi,
        equipes: niveau.parties,
    })));
}

/** Numéro de case, sur la route, de la 1re partie de l'étape `index` (une case par partie, le tutoriel est la
 *  case 0). */
export function numeroDeCase(etapes: Etape[], index: number): number {
    return 1 + etapes.slice(0, index).reduce((n, e) => n + e.equipes.length, 0);
}

/** Personnages que le joueur a vus avant l'étape `index` : son équipe de départ, puis les recrues. */
export function personnagesVus(roi: Roi, index: number): Set<Nom> {
    const vus = new Set<Nom>([...EQUIPE_DE_DEPART.champions, ...EQUIPE_DE_DEPART.pions]);
    route(roi).slice(0, index).forEach(e => vus.add(e.recrue));
    return vus;
}

// Cases du camp blanc (colonne 0 = a, rangée 1 ou 2). Le camp noir est le demi-tour du plateau.
const CASES: Record<Plateau, { largeur: number, roi: number, champions: number[], pions: number[] }> = {
    matatak: { largeur: 8, roi: 4, champions: [3, 5], pions: [3, 4, 5] }, // Roi e1, Champions d1 f1, Pions d2 e2 f2
    matatakmini: { largeur: 4, roi: 2, champions: [1, 3], pions: [1, 2, 3] }, // Roi c1, Champions b1 d1, Pions b2 c2 d2
};

/** Position de départ (FEN) : `blancs` commence. Avec 5 places, le 3e Pion n'a pas de Champion derrière lui. */
export function positionDeDepart(plateau: Plateau, blancs: Equipe, noirs: Equipe): string {
    const { largeur, roi, champions, pions } = CASES[plateau];
    const rangees: string[][] = Array.from({ length: 8 }, () => Array(largeur).fill(''));
    // rangees[0] = 8e rangée, rangees[7] = 1re rangée
    const poser = (equipe: Equipe, blanc: boolean) => {
        const mettre = (colonne: number, rangee: number, lettre: string) => {
            const c = blanc ? colonne : largeur - 1 - colonne;
            const r = blanc ? 8 - rangee : rangee - 1;
            rangees[r][c] = blanc ? lettre.toUpperCase() : lettre;
        };
        mettre(roi, 1, 'k');
        equipe.champions.forEach((nom, i) => mettre(champions[i], 1, PERSONNAGES[nom].lettre));
        equipe.pions.forEach((nom, i) => mettre(pions[i], 2, PERSONNAGES[nom].lettre));
    };
    poser(blancs, true);
    poser(noirs, false);
    const placement = rangees
        .map(rangee => rangee.map(c => c || '1').join('').replace(/1+/g, vides => String(vides.length)))
        .join('/');
    return `${placement} w - - 0 1`;
}
