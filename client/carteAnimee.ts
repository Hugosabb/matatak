import { h, VNode } from 'snabbdom';

// Cartes animées réutilisables (styles dans matatak-ui.css, classes .carte-3d, .duo-echange).
// Les cartes du jeu sont recto-verso : la face sombre devant (les Personnages y rendent mieux),
// la face claire au dos, visible quand la carte se retourne.

const COLLECTION = '/static/images/background/collection/';

function faces(fichier: string): VNode[] {
    return [
        h('img.face.avant', { attrs: { src: `${COLLECTION}sombre-720/${fichier}`, alt: '', loading: 'lazy' } }),
        h('img.face.dos', { attrs: { src: `${COLLECTION}clair-720/${fichier}`, alt: '', loading: 'lazy' } }),
    ];
}

/** Une carte seule : elle flotte, et se retourne de temps en temps. */
export function carteTournante(fichier: string, sel = 'span.carte-3d.tourne'): VNode {
    return h('span.carte-flotte', [h(sel, faces(fichier))]);
}

/** Deux cartes qui échangent leurs places, comme deux joueurs : l'une passe par-dessus en arc,
 *  l'autre par-dessous, en tournant sur elles-mêmes. Trois mouvements superposés et continus
 *  (trajet, flottement, rotation) : même fluidité que la carte seule. */
export function duoEchange(gauche: string, droite: string): VNode {
    const joueur = (sel: string, fichier: string) =>
        h(`span.duo-place.${sel}`, [h('span.duo-flotte', [h('span.carte-3d.duo-tour', faces(fichier))])]);
    return h('span.duo-echange', [joueur('a', gauche), joueur('b', droite)]);
}
