import { h, VNode } from 'snabbdom';

import { PyChessModel } from './types';
import { installeur, ouvrirInstallation } from './installer';

// Page « Apprendre » : le tutoriel, les Personnages (Collection), la campagne de puzzles, puis les
// outils des joueurs avancés. Un seul bouton doré : le tutoriel tant qu'il n'est pas fini, sinon la
// campagne. La progression vient de l'appareil (tutorialCtrl.ts, puzzleCtrl.ts).

// Face sombre : les Personnages y rendent mieux (Hugo)
const CARTES = '/static/images/background/collection/sombre/';
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

    const personnages = h('section.bloc.personnages', [
        h('div.illus.trio', ['34-bongo.webp', '01-azar.webp', '24-salsa.webp'].map(f => h('img', { attrs: { src: CARTES + f, alt: '' } }))),
        h('div.txt', [
            h('h2', 'Collection'),
            h('p', 'Les 42 Personnages, leurs déplacements, et un mini-jeu pour les prendre en main.'),
            bouton(false, '/collection', 'Voir la Collection'),
        ]),
    ]);

    const campagne = h('section.bloc.campagne', [
        h('div.illus', [h('img', { attrs: { src: CARTES + '18-jazz.webp', alt: '' } })]),
        h('div.txt', [
            h('h2', 'Campagne de puzzles'),
            h('p', resolus > 0 ? `${resolus} niveau${resolus > 1 ? 'x' : ''} réussi${resolus > 1 ? 's' : ''} sur 200. Un coup à trouver, de plus en plus rusé.` : '200 positions où trouver le coup gagnant, du plus simple au plus rusé.'),
            resolus > 0 ? h('div.barre', h('i', { style: { width: `${resolus / 2}%` } })) : '',
            bouton(tutorielFini, '/puzzle/campaign/matatakmini', resolus > 0 ? `Niveau ${Math.min(200, resolus + 1)}` : 'Commencer'),
        ]),
    ]);

    return [h('div.apprendre-page', [
        h('h1', 'Apprendre'),
        tutoriel,
        personnages,
        campagne,
        h('nav.outils', { attrs: { 'aria-label': 'Outils' } }, [
            h('span', 'Outils'),
            lien('a', '/analysis/matatakmini', ['Analyse']),
            lien('a', '/editor/matatakmini', ['Éditeur de position']),
            // Installer l'appli : rangé ici plutôt qu'affiché partout (absent dans l'appli installée)
            (() => { const i = installeur(); return i && !i.installee()
                ? h('button', { attrs: { type: 'button' }, on: { click: () => ouvrirInstallation() } }, "Installer l'appli") : ''; })(),
        ]),
    ])];
}
