// Équipes de départ des Saisons (livret, page 3 ; mêmes que client/collection.ts EQUIPES) : entre amis, on
// choisit l'équipe d'une Saison, pas un Roi (Hugo, 10/11/2026 : « ça peut prêter à confusion avec
// l'Aventure, où on choisit juste le Roi »). Vignette : les 3 cartes de l'équipe en éventail.

import { h, VNode } from 'snabbdom';

export type SaisonEquipe = 'ete' | 'automne' | 'hiver' | 'printemps';

const CARTES = '/static/images/background/collection/sombre/';

export const EQUIPES_SAISON: Record<SaisonEquipe, { saison: string; nom: string; cartes: [string, string, string] }> = {
    ete: { saison: 'Été', nom: 'Fougue', cartes: ['01-azar.webp', '10-krak.webp', '35-tamtam.webp'] },
    automne: { saison: 'Automne', nom: 'Zen', cartes: ['02-shans.webp', '26-rokk.webp', '33-shasha.webp'] },
    hiver: { saison: 'Hiver', nom: 'Zigzag', cartes: ['03-karma.webp', '11-frank.webp', '34-bongo.webp'] },
    printemps: { saison: 'Printemps', nom: 'Charme', cartes: ['04-mojo.webp', '13-dysko.webp', '19-banjo.webp'] },
};
export const ORDRE_SAISONS: SaisonEquipe[] = ['ete', 'automne', 'hiver', 'printemps'];

/** Le Roi devant, son Champion et son Pion derrière. */
export function vignetteEquipe(saison: SaisonEquipe): VNode {
    const [roi, champion, pion] = EQUIPES_SAISON[saison].cartes;
    const img = (f: string, sel: string) => h(`img.${sel}`, { attrs: { src: CARTES + f, alt: '', loading: 'lazy' } });
    return h('span.vignette-equipe', { style: { '--c': `var(--mt-${saison})` } }, [img(champion, 'c1'), img(pion, 'c2'), img(roi, 'c0')]);
}

/** Libellé sous la vignette : la Saison, et le nom de l'équipe pour les lecteurs d'écran. */
export function libelleEquipe(saison: SaisonEquipe): string {
    return EQUIPES_SAISON[saison].saison;
}
