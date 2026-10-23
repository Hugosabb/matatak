import { h, VNode } from 'snabbdom';

import { PyChessModel } from './types';
import { installeur, ouvrirInstallation } from './installer';

// Page « Apprendre » : le tutoriel, les Personnages (Collection), la campagne de puzzles, puis les
// outils des joueurs avancés. Un seul bouton doré : le tutoriel tant qu'il n'est pas fini, sinon la
// campagne. La progression vient de l'appareil (tutorialCtrl.ts, puzzleCtrl.ts).

// Face sombre : les Personnages y rendent mieux (Hugo)
const CARTES = '/static/images/background/collection/sombre/';
const PLATEAUX = '/static/images/background/collection/plateaux/';
const TOTAL_TUTORIEL = 8;

function lire(cle: string): string | null {
    try { return localStorage.getItem(cle); } catch { return null; }
}

function niveauxResolus(): number {
    try { return JSON.parse(lire('matatak_campaign_solved_matatakmini') || '[]').length; } catch { return 0; }
}

export function apprendreView(_model: PyChessModel): VNode[] {
    const tutorielFini = lire('matatak_tutoriel') === 'fini';
    const etape = Math.min(TOTAL_TUTORIEL - 1, Number(lire('matatak_tutoriel_etape')) || 0);
    const resolus = niveauxResolus();
    const lien = (sel: string, href: string, contenu: (VNode | string)[]) => h(sel, { attrs: { href } }, contenu);
    const bouton = (principal: boolean, href: string, texte: string) =>
        lien(principal ? 'a.mt-btn.mt-btn-or' : 'a.mt-btn.mt-btn-petit.mt-btn-ligne', href, [texte]);

    const tutoriel = h('section.bloc.tutoriel', { class: { fait: tutorielFini } }, [
        h('div.illus', [h('img', { attrs: { src: CARTES + '35-tamtam.webp', alt: '' } })]),
        h('div.txt', [
            h('h2', 'Tutoriel'),
            h('p', tutorielFini
                ? 'Terminé ! Recommencez quand vous voulez pour réviser les règles.'
                : 'Se déplacer, capturer et les deux façons de gagner : 8 petites étapes, 2 minutes.'),
            tutorielFini || etape === 0 ? '' : h('div.barre', h('i', { style: { width: `${etape / TOTAL_TUTORIEL * 100}%` } })),
            tutorielFini
                ? bouton(false, '/tutorial/1', 'Recommencer')
                : bouton(true, `/tutorial/${etape + 1}`, etape > 0 ? `Reprendre · étape ${etape + 1}` : 'Commencer'),
        ]),
    ]);

    // Les autres rubriques : 4 tuiles entièrement cliquables (une seule action principale par écran :
    // le Tutoriel ; Hugo 23/10/2026 : Analyse et Éditeur présentés comme les autres)
    const tuile = (classe: string, href: string, illus: VNode, titre: string, texte: string, extra: VNode | string = '') =>
        h(`a.tuile.${classe}`, { attrs: { href } }, [h('div.t-illus', [illus]), h('h2', titre), h('p', texte), extra]);
    const carte = (f: string) => h('img', { attrs: { src: CARTES + f, alt: '', loading: 'lazy' } });

    const tuiles = h('div.tuiles', [
        tuile('collection', '/collection',
            h('div.trio', ['34-bongo.webp', '01-azar.webp', '24-salsa.webp'].map(carte)),
            'Collection', 'Les 42 Personnages et un mini-jeu.'),
        tuile('puzzles', '/puzzle/campaign/matatakmini', carte('18-jazz.webp'),
            'Puzzles', resolus > 0 ? `${resolus} niveau${resolus > 1 ? 'x' : ''} sur 200.` : '200 coups gagnants à trouver.',
            resolus > 0 ? h('div.barre', h('i', { style: { width: `${resolus / 2}%` } })) : ''),
        tuile('analyse', '/analysis/matatakmini', carte('09-bluff.webp'),
            'Analyse', 'Brillant ou gaffe ? Le moteur vous le dit.'),
        tuile('editeur', '/editor/matatakmini',
            h('img.plateau', { attrs: { src: PLATEAUX + 'matatak8x8-720.webp', alt: '', loading: 'lazy' } }),
            'Éditeur', 'Composez une position, puis jouez-la.'),
    ]);

    // Installer l'appli : rangé ici plutôt qu'affiché partout (absent dans l'appli installée)
    const installer = (() => { const i = installeur(); return i && !i.installee()
        ? h('button.installer', { attrs: { type: 'button' }, on: { click: () => ouvrirInstallation() } }, "Installer l'appli") : ''; })();

    return [h('div.apprendre-page', [
        h('h1', 'Apprendre'),
        tutoriel,
        tuiles,
        installer,
    ])];
}
