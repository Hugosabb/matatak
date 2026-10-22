import { beforeEach, expect, test } from '@jest/globals';

import { equipeMemorisee, fenPourCouleur, memoriserEquipe, tournerFen } from '../client/equipe';
import { VARIANTS } from '../client/variants';

const FEN = '4kq2/4pp2/8/8/8/8/3PP3/3QK3[FFff] w - - 0 1';

beforeEach(() => localStorage.clear());

test('demi-tour du plateau en échangeant les camps', () => {
    expect(tournerFen(FEN)).toBe('3kq3/3pp3/8/8/8/8/2PP4/2QK4[ffFF] w - - 0 1');
});

test('deux demi-tours rendent la position de départ', () => {
    for (const v of ['matatak', 'matatakmini']) {
        const fen = VARIANTS[v].startFen;
        expect(tournerFen(tournerFen(fen))).toBe(fen);
    }
});

test('on retrouve son équipe quelle que soit sa couleur', () => {
    memoriserEquipe('matatak', FEN, 'white');
    const equipe = equipeMemorisee('matatak')!;
    expect(fenPourCouleur(equipe, 'w')).toBe(FEN);
    expect(fenPourCouleur(equipe, 'b')).toBe(tournerFen(FEN));
});

test('le Draft (plateau sans Rois) n\'est pas mémorisé', () => {
    memoriserEquipe('matatak', '8/8/8/8/8/8/8/8[FFff] w - - 0 1', 'white');
    expect(equipeMemorisee('matatak')).toBeNull();
    memoriserEquipe('chess', FEN, 'white');
    expect(equipeMemorisee('chess')).toBeNull();
});
