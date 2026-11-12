// Équipes de départ des Saisons (livret, page 3 ; mêmes que client/collection.ts EQUIPES) : entre amis, on
// choisit l'équipe d'une Saison, pas un Roi (Hugo, 10/11/2026 : « ça peut prêter à confusion avec
// l'Aventure, où on choisit juste le Roi »).

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
function vignetteEquipe(saison: SaisonEquipe): VNode {
    const [roi, champion, pion] = EQUIPES_SAISON[saison].cartes;
    const img = (f: string, sel: string) => h(`img.${sel}`, { attrs: { src: CARTES + f, alt: '', loading: 'lazy' } });
    return h('span.vignette-equipe', [img(champion, 'c1'), img(pion, 'c2'), img(roi, 'c0')]);
}

/** Choix de l'équipe de départ (Hugo, 12/11/2026) : les 4 Saisons en 4 colonnes, chacune avec ses
 *  3 cartes en éventail ; « Au hasard » est un petit bouton à droite du titre, allumé tant qu'aucune
 *  équipe n'est choisie. Des boutons radio : le même bloc sert dans /jouer (Ami et Solo) et dans le
 *  formulaire de l'invitation (états par le CSS seul, matatak-ui.css). */
export function choixEquipe(valeur: SaisonEquipe | '', surChoix?: (v: SaisonEquipe | '') => void): VNode {
    const radio = (v: SaisonEquipe | '') => h(`input.s-${v || 'hasard'}`, {
        key: 'i' + v,
        attrs: { type: 'radio', name: 'equipe', value: v, id: `equipe-${v || 'hasard'}` },
        props: { checked: v === valeur },
        on: surChoix ? { change: () => surChoix(v) } : {},
    });
    return h('div.choix-equipe', { attrs: { role: 'radiogroup', 'aria-label': 'Équipe de Saison' } }, [
        radio(''),
        h('div.etiq', { key: 'tete' }, [
            h('span', 'Équipe de Saison'),
            h('label.eq-hasard', { attrs: { for: 'equipe-hasard' } }, [h('i'), 'Hasard']),
        ]),
        ...ORDRE_SAISONS.flatMap(v => [
            radio(v),
            h('label.choix-eq', { key: 'l' + v, attrs: { for: `equipe-${v}` } },
                [vignetteEquipe(v), h('small', EQUIPES_SAISON[v].saison), h('em', EQUIPES_SAISON[v].nom)]),
        ]),
    ]);
}
