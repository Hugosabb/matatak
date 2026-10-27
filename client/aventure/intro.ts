// Intro de l'Aventure (maquette validée par Hugo le 27/10/2026) : à la première visite de l'onglet Solo,
// avant le choix du Roi. « Touche pour commencer » (le toucher autorise le son), puis le texte du livret
// s'écrit lettre par lettre sur les tambours qui se rapprochent (static/sound/matatak/Intro, composé par
// outils/sons/intro.py) ; le texte finit juste avant le gros coup (pause), et « MATATAK ! » apparaît sur le
// ta-ka-TA qui suit.

import { h, VNode } from 'snabbdom';

import { IMAGE, Roi } from './personnages';

const CLE = 'matatak_intro_vue';
const CRI = 14.15; // le ta-ka-TA, en secondes depuis le début de la musique (outils/sons/intro.py)
const DEBUT = 0.4, FIN = 13.3, PAUSE = 0.35; // le texte s'écrit de 0,4 s à 13,3 s, une pause par paragraphe

const COULEUR = { MOJO: 'printemps', AZAR: 'ete', SHANS: 'automne', KARMA: 'hiver' } as const;
// Les Rois, dans l'ordre où le texte les nomme : chacun apparaît quand son nom s'écrit (Hugo)
const ROIS_DU_TEXTE: Roi[] = ['MOJO', 'AZAR', 'SHANS', 'KARMA'];
// Texte de l'introduction du livret (validé le 7 octobre 2026) ; [texte, Saison] pour les noms des Rois
const TEXTE: [string, string?][][] = [
    [['La nuit tombe sur la jungle.\nEntre les feuilles, deux yeux brillent.\nSur la Colline, le Mananas est mûr.']],
    [['Ici, les Saisons ne se succèdent pas :\nelles se disputent.']],
    [['Mojo', COULEUR.MOJO], [' rêve d’un Printemps en fleurs,\n'], ['Azar', COULEUR.AZAR], [' d’un Été brûlant,\n'],
        ['Shans', COULEUR.SHANS], [' d’un Automne qui danse\net '], ['Karma', COULEUR.KARMA], [' d’un Hiver qui fige tout.']],
    [['Le premier Roi qui goûtera au fruit tant convoité choisira la saison suivante.']],
    [['Qu’ils s’allient ou fassent cavalier seul, les Rois rassemblent leurs plus fidèles compagnons.']],
    [['Au loin, dans la nuit, les tambours résonnent de plus en plus fort.']],
    [['L’heure est venue…']],
];
const LONGUEURS = TEXTE.map(p => p.reduce((n, [t]) => n + t.length, 0));
const PAS = (FIN - DEBUT - PAUSE * (TEXTE.length - 1)) / LONGUEURS.reduce((a, b) => a + b, 0);

export function introVue(): boolean {
    try { return localStorage.getItem(CLE) === '1'; } catch { return true; }
}
function noterVue() {
    try { localStorage.setItem(CLE, '1'); } catch { /* navigation privée */ }
}

/** Nombre de lettres visibles de chaque paragraphe au temps t. */
function lettres(t: number): number[] {
    let reste = Math.max(0, t - DEBUT);
    return LONGUEURS.map(n => {
        const vues = reste >= n * PAS ? n : Math.floor(reste / PAS);
        reste = Math.max(0, reste - n * PAS - PAUSE);
        return vues;
    });
}

let boucle = 0;
let son: HTMLAudioElement | null = null;

function arreter() {
    cancelAnimationFrame(boucle);
    son?.pause();
    son = null;
}

/** Le texte et le cri suivent le temps de la musique (pas une minuterie : ils ne se décalent pas si
 *  l'appareil rame) ; sans son (refusé, absent), ils suivent l'horloge. */
function lancer(racine: HTMLElement) {
    arreter();
    racine.classList.add('en-cours');
    const depart = performance.now();
    son = new Audio();
    son.src = son.canPlayType('audio/ogg') ? '/static/sound/matatak/Intro.ogg' : '/static/sound/matatak/Intro.mp3';
    let avecSon = true;
    son.play().catch(() => { avecSon = false; });
    const segments = [...racine.querySelectorAll<HTMLElement>('.intro-p')].map(p => [...p.querySelectorAll<HTMLElement>('.intro-seg')]);
    const avancer = () => {
        const t = avecSon && son && !son.paused ? son.currentTime : (performance.now() - depart) / 1000;
        lettres(t).forEach((vues, i) => {
            let k = vues;
            TEXTE[i].forEach(([texte], j) => {
                const n = Math.max(0, Math.min(texte.length, k));
                k -= texte.length;
                const [vu, cache] = segments[i][j].children as unknown as HTMLElement[];
                if (vu.textContent!.length !== n) {
                    vu.textContent = texte.slice(0, n);
                    cache.textContent = texte.slice(n);
                    // Le nom d'un Roi est écrit en entier : sa carte apparaît
                    const saison = TEXTE[i][j][1];
                    if (saison && n === texte.length) racine.querySelector(`.av-intro-rois .${saison}`)?.classList.add('vu');
                }
            });
        });
        racine.classList.toggle('cri', t >= CRI);
        racine.classList.toggle('fin', t >= CRI + 0.6);
        if (t < CRI + 1) boucle = requestAnimationFrame(avancer);
    };
    boucle = requestAnimationFrame(avancer);
}

/** L'intro en plein écran ; `suite` : vers le choix du Roi. */
export function intro(suite: () => void): VNode {
    const finir = () => { arreter(); noterVue(); suite(); };
    return h('div.av-intro', { hook: { destroy: arreter } }, [
        // Le toucher qui lance tout : il autorise le son
        h('button.av-intro-depart', { attrs: { type: 'button' }, on: { click: (e: MouseEvent) => lancer((e.currentTarget as HTMLElement).closest('.av-intro') as HTMLElement) } }, [
            h('span.av-intro-losange'),
            h('b', 'Touche pour commencer'),
            h('span.av-intro-son', [
                h('svg', { attrs: { viewBox: '0 0 24 24', 'aria-hidden': 'true' } }, [
                    h('path', { attrs: { d: 'M4 9h4l5-4v14l-5-4H4z' } }),
                    h('path', { attrs: { d: 'M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13' } }),
                ]),
                'Monte le son !',
            ]),
        ]),
        h('div.av-intro-rois', ROIS_DU_TEXTE.map(roi => h(`img.${COULEUR[roi as keyof typeof COULEUR]}`, { attrs: { src: `/static/images/background/collection/sombre/${IMAGE[roi]}`, alt: '' } }))),
        h('div.av-intro-texte', { attrs: { 'aria-label': TEXTE.map(p => p.map(([t]) => t).join('')).join(' ') } }, TEXTE.map(p =>
            h('p.intro-p', { attrs: { 'aria-hidden': 'true' } }, p.map(([texte, saison]) =>
                h('span.intro-seg', { class: saison ? { [saison]: true, nom: true } : {} }, [h('span'), h('span.cache', texte)]))))),
        h('p.av-intro-cri', 'MATATAK !'),
        // En bas, toujours visible : « Passer » pendant l'intro, « Continuer » à la fin (même place)
        h('div.av-intro-bas', [
            h('button.av-intro-passer', { attrs: { type: 'button' }, on: { click: finir } }, 'Passer'),
            h('button.mt-btn.mt-btn-or.mt-btn-large.av-intro-continuer', { attrs: { type: 'button' }, on: { click: finir } }, "C'est parti !"),
        ]),
    ]);
}
