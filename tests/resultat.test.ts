import { expect, test } from '@jest/globals';

import { result } from '../client/result';
import { VARIANTS } from '../client/variants';

// Textes de fin de partie : vocabulaire du livret, pas celui de pychess (AUDIT P2-14)
test('le pat de Matatak s\'appelle Patatrak', () => {
    expect(result(VARIANTS['matatak'], 3, '1-0')).toContain('Patatrak');
    expect(result(VARIANTS['matatakmini'], 3, '0-1')).toContain('Patatrak');
});

test('la victoire par la Colline est nommée', () => {
    expect(result(VARIANTS['matatak'], 12, '1-0')).toContain('Colline');
    expect(result(VARIANTS['matatakmini'], 12, '0-1')).toContain('Colline');
});
