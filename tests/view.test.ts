import { expect, test } from '@jest/globals';

import { timeControlStr } from '../client/view';

test('cadence 0+0 affichée « Sans limite »', () => {
    expect(timeControlStr(0, 0)).toBe('Sans limite');
    expect(timeControlStr('0', 0, 0)).toBe('Sans limite');
});

test('cadences avec pendule inchangées', () => {
    expect(timeControlStr(5, 3)).toBe('5+3');
    expect(timeControlStr(0, 2)).toBe('0+2');
    expect(timeControlStr(1 / 2, 0)).toBe('½+0');
});
