// Tutoriel (maquette validée par Hugo le 27/10/2026) : une seule partie racontée sur le plateau Mini. Le Roi
// du joueur (celui choisi pour l'Aventure) guide dans une bulle ; la partie avance toute seule entre les
// étapes (coups « avant »), des flèches montrent les façons de sortir de l'échec (« demo »), plusieurs
// bonnes réponses sont acceptées. Données : server/tutorial_data.py.

import { h, VNode } from 'snabbdom';
import { PuzzleController } from './puzzleCtrl';
import { PyChessModel } from "./types";
import { patch } from './document';
import * as cg from 'chessgroundx/types';
import { updateMovelist } from './movelist';
import { uci2LastMove, UCIMove } from './chess';
import { appliquerRois } from './rois';
import { sound } from './sound';
import { IMAGE, Roi, SAISON_DU_ROI } from './aventure/personnages';
import { lire as lireAventure, noterPartieDemandee, prochainePartie } from './aventure/progression';

interface EtapeTutoriel {
    _id: string; moves: string; fen: string; title?: string; total?: number; saison?: string;
    avant?: string; bulle_avant?: Bulle; demo?: [string, string, string][]; bulle_demo?: Bulle;
    bulle: Bulle; consigne: string; aide?: string; erreurs?: Record<string, string>; succes: Bulle;
}

type Phase = 'avant' | 'demo' | 'joueur' | 'adversaire' | 'succes';
type Bulle = string | string[]; // une liste = plusieurs messages à la suite
type TypeMessage = 'roi' | 'aide' | 'erreur' | 'bravo' | 'demo' | 'etape';
interface Message { type: TypeMessage; texte: string; teinte: string }

const CARTES = '/static/images/background/collection/sombre/';
// Le temps de lire (Hugo : « ça va un peu vite »)
const PAUSE_AVANT = 1600; // entre deux coups joués tout seuls : le temps de voir la carte bouger
const PAUSE_REPONSE = 1100; // la réponse de l'adversaire
const PAUSE_SUITE = 1700; // après le bravo, avant l'étape suivante
const PAUSE_DEMO = 2600; // chaque flèche de la démonstration
const DELAI_MESSAGE = 1100; // entre deux messages du fil
const TEINTES: Record<string, string> = { ete: '#9bc781', hiver: '#92c9e0', printemps: '#da98c7', automne: '#eb963f' };

/** Progression sur l'appareil : dernière étape réussie, et « fini » à la fin (lu par /jouer). */
export function tutorielFini(): boolean {
    try { return localStorage.getItem('matatak_tutoriel') === 'fini'; } catch { return false; }
}
function noterProgression(etape: number, fini: boolean) {
    try {
        const avant = Number(localStorage.getItem('matatak_tutoriel_etape') || '0');
        if (etape > avant) localStorage.setItem('matatak_tutoriel_etape', String(etape));
        if (fini) localStorage.setItem('matatak_tutoriel', 'fini');
    } catch { /* navigation privée */ }
}

/** Fin du tutoriel : « Niveau 1 » lance tout de suite la 1re partie de l'Aventure (comme « Partie suivante »
 *  en fin de partie : /jouer/solo la crée et y mène) ; sans Aventure commencée, retour à l'onglet Solo. */
function lancerNiveau1() {
    const p = lireAventure();
    const partie = p ? prochainePartie(p) : null;
    if (!p || !partie) return window.location.assign('/jouer?aventure=1');
    noterPartieDemandee(p, partie);
    const q = new URLSearchParams({
        variant: partie.variant, level: String(partie.niveau), fen: partie.fen, color: partie.couleur,
        rw: partie.rois.white, rb: partie.rois.black,
    });
    window.location.assign(`/jouer/solo?${q}`);
}

/** Le Roi choisi pour l'Aventure guide le tutoriel ; MOJO sans Aventure commencée. Son rival : AZAR et
 *  l'équipe de l'Été, ou SHANS si le joueur a pris AZAR. */
function lesRois(): { roi: Roi, rival: Roi } {
    let roi: Roi = 'MOJO';
    try {
        const p = JSON.parse(localStorage.getItem('matatak_aventure') ?? 'null');
        if (p?.roi && p.roi in SAISON_DU_ROI) roi = p.roi;
    } catch { /* navigation privée ou progression illisible */ }
    return { roi, rival: roi === 'AZAR' ? 'SHANS' : 'AZAR' };
}

export class TutorialController extends PuzzleController {
    etape: EtapeTutoriel;
    tutorialId: number;
    total = 11;
    assets = '/static';
    roi: Roi;
    rival: Roi;
    phase: Phase = 'joueur';
    attendus: string[][] = []; // une entrée par coup, joueur et adversaire en alternance
    rang = 0; // prochaine entrée de « attendus »
    fil: Message[] = []; // tout ce que le Roi a dit depuis le début du tutoriel
    attente: Message[] = []; // messages pas encore affichés (un par un)
    minuteurFil = 0;
    minuteurs: number[] = [];
    vinfos: VNode | null = null;

    constructor(el: HTMLElement, model: PyChessModel) {
        super(el, model);
        this.etape = JSON.parse(model.puzzle);
        this.tutorialId = parseInt(this._id);
        this.assets = model['assetURL'];
        ({ roi: this.roi, rival: this.rival } = lesRois());

        // Ni classement, ni enchaînement, ni indice des puzzles
        for (const sel of ['.puzzle-user', '.puzzle-info']) (document.querySelector(sel) as HTMLElement | null)?.style.setProperty('display', 'none');
        for (const sel of ['.hint', '.solution']) {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) patch(el, h('div'));
        }
        document.body.classList.add('en-partie');
        this.chessground.set({ drawable: { brushes: { ...this.chessground.state.drawable.brushes, ...Object.fromEntries(Object.entries(TEINTES).map(([k, color]) => [k, { key: k, color, opacity: 0.95, lineWidth: 12 }])) } } });
        this.demarrer();

        // Les étapes s'enchaînent sur place : « Retour » du navigateur recharge l'étape demandée
        window.addEventListener('popstate', () => window.location.reload());
    }

    /** {rival}, {roi}, et des espaces insécables devant « ! ? : ; » : le « ! » ne passe jamais seul à la
     *  ligne (Hugo). */
    private texte(s?: string): string {
        return (s ?? '').replace(/\{rival\}/g, this.rival).replace(/\{roi\}/g, this.roi)
            .replace(/ ([!?:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
    }

    private plus(ms: number, f: () => void) {
        this.minuteurs.push(window.setTimeout(f, ms));
    }

    /** Une étape commence : position, Rois du plateau, puis les coups joués tout seuls, la démonstration,
     *  et enfin la main au joueur. */
    /** Ajoute un message au fil, après ceux qui attendent : ils arrivent un par un, comme dans une
     *  discussion (Hugo, 27/10/2026). Un message qui répète le précédent est ignoré. */
    private dire(texte: string, type: TypeMessage = 'roi', teinte = '') {
        const t = this.texte(texte);
        if (!t) return;
        const dernier = this.attente[this.attente.length - 1] ?? this.fil[this.fil.length - 1];
        if (dernier && dernier.texte === t && dernier.type === type) return;
        this.attente.push({ type, texte: t, teinte });
        if (!this.minuteurFil) this.servir();
    }

    private direTout(bulle: Bulle | undefined, type: TypeMessage = 'roi') {
        (Array.isArray(bulle) ? bulle : [bulle ?? '']).forEach(t => this.dire(t, type));
    }

    private servir() {
        const m = this.attente.shift();
        if (!m) { this.minuteurFil = 0; return; }
        this.fil.push(m);
        if (m.type !== 'etape') sound.message();
        this.renderInfos();
        this.minuteurFil = window.setTimeout(() => this.servir(), DELAI_MESSAGE);
    }

    private demarrer() {
        this.minuteurs.forEach(clearTimeout);
        this.minuteurs = [];
        const e = this.etape;
        this.total = e.total || this.total;
        this.attendus = e.moves.split(',').map(x => x.split('|'));
        this.rang = 0;
        this.mycolor = 'white';
        this.color = 'white';
        this.chessground.set({ orientation: 'white', movable: { color: undefined } });
        appliquerRois(this.assets, SAISON_DU_ROI[this.roi], SAISON_DU_ROI[this.rival]);
        // Le titre de l'étape, en tête de ses messages : « DYSKO rejoint l'équipe ! », « Capturer »
        this.dire(e.title ?? '', 'etape');

        const avant = (e.avant ?? '').split(',').filter(Boolean);
        if (avant.length) {
            this.phase = 'avant';
            this.direTout(e.bulle_avant);
            this.renderInfos();
            avant.forEach((coup, i) => this.plus(PAUSE_AVANT * (i + 1), () => this.jouerSeul(coup)));
            this.plus(PAUSE_AVANT * (avant.length + 1), () => this.apresAvant());
        } else {
            this.apresAvant();
        }
    }

    /** Démonstration : les flèches s'ajoutent l'une après l'autre, chacune avec sa légende dans le fil ;
     *  elles restent sur le plateau jusqu'au coup du joueur. */
    private apresAvant() {
        const demo = this.etape.demo ?? [];
        if (!demo.length) return this.aToi();
        this.phase = 'demo';
        this.direTout(this.etape.bulle_demo);
        this.renderInfos();
        demo.forEach(([, teinte, legende], i) => this.plus(PAUSE_DEMO * i + 400, () => {
            this.chessground.setAutoShapes(demo.slice(0, i + 1).map(([c, t]) => ({ orig: c.slice(0, 2) as cg.Key, dest: c.slice(2, 4) as cg.Key, brush: t })));
            this.dire(legende, 'demo', teinte);
            this.renderInfos();
        }));
        this.plus(PAUSE_DEMO * demo.length, () => this.aToi());
    }

    private aToi() {
        this.phase = 'joueur';
        this.direTout(this.etape.bulle);
        if (this.etape.aide) this.dire(this.etape.aide, 'aide');
        this.chessground.set({ turnColor: 'white', movable: { color: 'white' } });
        this.setDests();
        this.renderInfos();
    }

    /** Un coup joué par le tutoriel (adversaire, ou la partie qui avance), avec son bruit. */
    private jouerSeul(coup: string) {
        const prise = this.chessground.state.boardState.pieces.has(coup.slice(2, 4) as cg.Key);
        this.makeMove(coup);
        sound.moveSound(this.variant, prise);
        this.chessground.set({ movable: { color: undefined } });
    }

    doSendMove(move: string) {
        if (this.phase !== 'joueur') return this.annuler();
        const attendu = this.attendus[this.rang] ?? [];
        if (!(attendu.includes(move) || (attendu[0] === '*' && this.gagnant(move)))) {
            this.fil.push({ type: 'erreur', texte: this.texte(this.etape.erreurs?.[move]) || "Ce n'est pas ce qui est demandé : essaie encore !", teinte: '' });
            this.annuler();
            this.renderInfos();
            return;
        }
        this.chessground.setAutoShapes([]);
        this.makeMove(move);
        this.rang += 1;
        if (this.rang >= this.attendus.length) return this.reussite();
        // L'adversaire répond, puis la main revient au joueur
        this.phase = 'adversaire';
        this.chessground.set({ movable: { color: undefined } });
        this.renderInfos();
        this.plus(PAUSE_REPONSE, () => {
            this.jouerSeul(this.attendus[this.rang][0]);
            this.rang += 1;
            if (this.rang >= this.attendus.length) return this.reussite();
            this.aToi();
        });
    }

    /** « * » : n'importe quel coup qui gagne tout de suite (échec et mat, ou la Colline). */
    private gagnant(move: string): boolean {
        this.ffishBoard.push(move);
        const resultat = this.ffishBoard.result();
        this.ffishBoard.pop();
        return resultat === (this.turnColor === 'white' ? '1-0' : '0-1');
    }

    /** Mauvais coup (ou coup pendant une animation) : la carte revient à sa place. */
    private annuler() {
        this.goPly(this.ply);
        this.ffishBoard.setFen(this.fullfen);
        if (this.phase !== 'joueur') this.chessground.set({ movable: { color: undefined } });
        else this.setDests();
    }

    /** Étape réussie : le bravo s'ajoute au fil et l'étape suivante enchaîne toute seule (Hugo : « génial
     *  de pas avoir à cliquer sur Suivant ») ; seule la dernière s'arrête, sur la victoire. */
    private reussite() {
        this.chessground.set({ movable: { color: undefined } });
        const derniere = this.tutorialId >= this.total;
        noterProgression(this.tutorialId, derniere);
        this.direTout(this.etape.succes, 'bravo');
        // Partie gagnée (échec et mat, Colline) : le son de victoire
        if (this.ffishBoard.result() === '1-0') sound.victory();
        if (derniere) {
            this.phase = 'succes';
            this.renderInfos();
            (document.querySelector('.tuto-suite .mt-btn') as HTMLElement | null)?.focus();
            return;
        }
        this.phase = 'adversaire';
        this.renderInfos();
        this.plus(PAUSE_SUITE, () => this.nextTutorial());
    }

    // Les écrans des puzzles ne servent pas ici
    yourTurn() {}
    notTheMove() {}
    bestMove() {}
    puzzleComplete() {}

    /** « Quitter » : retour à l'Aventure ; le tutoriel reste à reprendre (niveau 0). */
    private quitter() {
        window.location.assign('/jouer?aventure=1');
    }

    /** Le fil de discussion du Roi : tout ce qu'il a dit depuis le début, le plus récent en bas ; on le fait
     *  défiler pour relire (Hugo, 27/10/2026). */
    private leFil(): VNode {
        const descendre = (el: HTMLElement) => { el.scrollTop = el.scrollHeight; };
        return h('div.tuto-fil', {
            attrs: { 'aria-live': 'polite' },
            hook: {
                insert: v => descendre(v.elm as HTMLElement),
                postpatch: (ancien, v) => {
                    // Un nouveau message : on descend, sauf si le joueur est remonté relire
                    const el = v.elm as HTMLElement;
                    if ((ancien.children?.length ?? 0) !== (v.children?.length ?? 0)) descendre(el);
                },
            },
        }, this.fil.map(m => m.type === 'roi'
            ? h('p.tuto-bulle', m.texte)
            : h(`p.tuto-${m.type}${m.teinte ? '.' + m.teinte : ''}`, m.texte)));
    }

    renderInfos() {
        // Appelé aussi par le constructeur des puzzles, avant que l'étape soit lue
        if (!this.etape) return;
        // Le panneau est mis à jour en place (patcher l'élément à chaque fois en ajoutait un nouveau)
        const cible = this.vinfos ?? document.querySelector('.infos') as HTMLElement | null;
        if (!cible) return;
        const fini = this.phase === 'succes';
        // La consigne d'abord, puis le fil du Roi, et en bas la progression et « Quitter » (sur téléphone, ce
        // bloc est sous le plateau : le plateau ne bouge plus quand le texte change, Hugo 27/10/2026)
        this.vinfos = patch(cible, h('div.infos.tutorial-info', { class: { fini } }, [
            fini
                ? h('h2.tuto-victoire', 'À nous le Mananas\u00a0!')
                : h('p.tuto-consigne', { class: { attente: this.phase !== 'joueur' } }, this.texte(this.etape.consigne)),
            h('div.tuto-discussion', [
                h('img', { attrs: { src: CARTES + IMAGE[this.roi], alt: this.roi } }),
                this.leFil(),
            ]),
            fini ? h('div.tuto-suite', [h('button.mt-btn.mt-btn-or', { attrs: { type: 'button' }, on: { click: () => lancerNiveau1() } }, 'Niveau 1')]) : '',
            h('div.tuto-pied', [
                h('span.tuto-num', `${this.tutorialId} / ${this.total}`),
                fini ? '' : h('button.tuto-passer', { attrs: { type: 'button' }, on: { click: () => this.quitter() } }, 'Quitter'),
            ]),
        ]));
        this.recalerPlateau();
    }

    nextTutorial() {
        const suivante = this.tutorialId + 1;
        // Étape suivante chargée sur place : le plateau reste affiché, seules les pièces changent
        fetch(`/api/tutorial/${suivante}`)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then((etape: EtapeTutoriel) => {
                this.chargerEtape(etape);
                history.pushState({ etape: suivante }, '', `/tutorial/${suivante}`);
            })
            .catch(() => window.location.assign(`/tutorial/${suivante}`)); // en dernier recours, rechargement
    }

    private chargerEtape(etape: EtapeTutoriel) {
        this.etape = etape;
        this._id = etape._id;
        this.tutorialId = parseInt(etape._id);
        this.solution = etape.moves.split(',') as UCIMove[];
        this.moves = [];
        this.ply = 0;
        this.plyVari = 0;
        this.failed = false;
        this.completed = false;
        this.posted = false;

        // L'étape continue la partie (même position) : rien ne doit bouger ni clignoter (Hugo)
        const suite = this.fullfen.split(' ')[0] === etape.fen.split(' ')[0];
        const dernierCoup = suite ? this.chessground.state.lastMove : undefined;
        this.fullfen = etape.fen;
        this.turnColor = etape.fen.split(' ')[1] === 'w' ? 'white' : 'black' as cg.Color;
        this.ffishBoard.setFen(this.fullfen);
        this.steps = [{ fen: this.fullfen, turnColor: this.turnColor, check: false, move: undefined }];

        this.chessground.set({
            fen: this.fullfen,
            turnColor: this.turnColor,
            lastMove: dernierCoup ?? uci2LastMove(undefined),
            check: false,
            drawable: { shapes: [], autoShapes: [] },
        });
        this.chessground.selectSquare(null);
        updateMovelist(this);

        // Apparition en fondu des nouvelles cartes (Personnages qui rejoignent l'équipe, équipe adverse)
        const wrap = document.querySelector('.tutorial-app .cg-wrap');
        if (wrap && !suite) {
            wrap.classList.remove('changement');
            void (wrap as HTMLElement).offsetWidth; // relance l'animation
            wrap.classList.add('changement');
        }
        this.demarrer();
    }

    /** Le cadre du haut change de hauteur : le plateau se déplace à l'écran. chessground garde en mémoire
     *  son ancienne position et décalait alors chaque toucher d'une case. */
    private recalerPlateau() {
        requestAnimationFrame(() => this.chessground.state.dom.bounds.clear());
    }
}
