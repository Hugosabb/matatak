import { h, VNode } from 'snabbdom';

// Cartes animées réutilisables (styles dans matatak-ui.css, « Cartes animées »). Les cartes du jeu sont
// recto-verso : la face sombre devant (les Personnages y rendent mieux), la face claire au dos, visible
// quand la carte se retourne.
//
// Une carte animée a un mouvement d'attente léger mais visible (ATTENTES), et fait de temps en temps un
// tour sur elle-même : un seul chef d'orchestre pour toute la page, qui fait tourner les cartes visibles
// une par une (chacune environ toutes les 8 s, jamais toutes ensemble), et un tour quand on la touche
// (Hugo, 27/10/2026).

const COLLECTION = '/static/images/background/collection/';

/** Mouvements d'attente disponibles (classes .attente-… de matatak-ui.css). */
export type Attente = 'flotte' | 'respire' | 'balance' | 'aucune';
export const ATTENTES: Attente[] = ['flotte', 'respire', 'balance', 'aucune'];

const PERIODE = 8000; // chaque carte tourne environ toutes les 8 s

function faces(fichier: string): VNode[] {
    return [
        h('img.face.avant', { attrs: { src: `${COLLECTION}sombre-720/${fichier}`, alt: '', loading: 'lazy' } }),
        h('img.face.dos', { attrs: { src: `${COLLECTION}clair-720/${fichier}`, alt: '', loading: 'lazy' } }),
    ];
}

// ---------- Le chef d'orchestre des tours ----------

const inscrites = new Set<HTMLElement>();
let minuteur = 0;
let rang = 0;

const calme = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function visible(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}

/** Un tour complet (bond, rotation, atterrissage écrasé), sauf s'il est déjà en cours. `cible` : ce qui
 *  tourne dans la carte (la carte elle-même, ou son enveloppe de saut pour le duo). */
export function tourner(carte: HTMLElement, cible = '.carte-3d') {
    const c = carte.matches(cible) ? carte : carte.querySelector<HTMLElement>(cible);
    if (!c || c.classList.contains('en-tour')) return;
    c.classList.add('en-tour');
    c.addEventListener('animationend', () => c.classList.remove('en-tour'), { once: true });
}

function prochainTour() {
    for (const el of inscrites) if (!el.isConnected) inscrites.delete(el);
    if (!inscrites.size) { minuteur = 0; return; }
    const vivantes = [...inscrites].filter(visible);
    if (vivantes.length && !calme()) tourner(vivantes[rang++ % vivantes.length]);
    // Une carte à la fois : avec n cartes à l'écran, un tour toutes les 8/n s
    minuteur = window.setTimeout(prochainTour, PERIODE / Math.max(1, vivantes.length));
}

function inscrire(el: HTMLElement) {
    inscrites.add(el);
    if (!minuteur) minuteur = window.setTimeout(prochainTour, PERIODE / 2);
}

/** Enveloppe animée autour d'une carte déjà construite (`span.carte-3d` avec ses faces) : mouvement
 *  d'attente au choix, tour de temps en temps et au toucher. Sert aussi aux cartes de la route de
 *  l'Aventure, qui ont leurs propres images. */
export function enveloppeAnimee(attente: Attente, carte: VNode): VNode {
    return h(`span.carte-anim.attente-${attente}`, {
        // Chaque carte commence son mouvement d'attente à un moment différent
        style: { animationDelay: `-${(Math.random() * 4).toFixed(2)}s` },
        hook: { insert: v => inscrire(v.elm as HTMLElement) },
        on: { click: (e: MouseEvent) => tourner(e.currentTarget as HTMLElement) },
    }, [carte]);
}

/** Une carte animée : mouvement d'attente au choix, tour de temps en temps et au toucher. */
export function carteAnimee(fichier: string, attente: Attente = 'flotte'): VNode {
    return enveloppeAnimee(attente, h('span.carte-3d', faces(fichier)));
}

/** Une carte seule de /jouer : elle flotte, et tourne de temps en temps (et au toucher). */
export function carteTournante(fichier: string): VNode {
    return carteAnimee(fichier, 'flotte');
}

/** Deux cartes qui échangent leurs places, comme deux joueurs : l'une passe par-dessus en arc,
 *  l'autre par-dessous, en tournant sur elles-mêmes. Trois mouvements superposés et continus
 *  (trajet, flottement, rotation) : même fluidité que la carte seule. */
export function duoEchange(gauche: string, droite: string): VNode {
    // Toucher une carte du duo la fait bondir et tourner (span.duo-saut, par-dessus ses propres mouvements)
    const joueur = (sel: string, fichier: string) =>
        h(`span.duo-place.${sel}`, { on: { click: (e: MouseEvent) => tourner(e.currentTarget as HTMLElement, '.duo-saut') } },
            [h('span.duo-flotte', [h('span.duo-saut', [h('span.carte-3d.duo-tour', faces(fichier))])])]);
    return h('span.duo-echange', [joueur('a', gauche), joueur('b', droite)]);
}
