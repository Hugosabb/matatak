import { h, VNode } from 'snabbdom';
import { PuzzleController } from './puzzleCtrl';
import { PyChessModel } from "./types";
import { patch } from './document';
import * as cg from 'chessgroundx/types';
import { updateMovelist } from './movelist';
import { uci2LastMove, UCIMove } from './chess';
import { appliquerRois, saisonDuCamp } from './rois';

interface EtapeTutoriel {
    _id: string; moves: string; fen: string; instruction: string; success_msg: string; title?: string;
    chapitre?: number; chapitre_nom?: string; carte?: string; cible?: string; total?: number;
    equipe?: PersoEquipe[];
}
interface PersoEquipe { carte: string; nom: string; lettre: string; rang: string; deplacement: string }

const VIGNETTES = '/static/images/background/collection/clair/';

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

export class TutorialController extends PuzzleController {
    instruction: string;
    successMsg: string;
    title: string;
    tutorialId: number;
    chapitreNom = '';
    chapitre = 0;
    carte = '';
    cible = '';
    equipe: PersoEquipe[] = [];
    selection = ''; // lettre du Personnage touché (présentation d'une équipe)
    assets = '/static';
    total = 10;

    constructor(el: HTMLElement, model: PyChessModel) {
        super(el, model);
        const data = JSON.parse(model.puzzle);
        this.instruction = data.instruction;
        this.successMsg = data.success_msg;
        this.title = data.title || '';
        this.tutorialId = parseInt(this._id);
        this.lireEtape(data);
        // Le Roi de chaque camp assorti à son équipe, comme en partie
        this.assets = model['assetURL'];
        appliquerRois(this.assets, saisonDuCamp(this.fullfen, 'white', this._id), saisonDuCamp(this.fullfen, 'black', this._id));
        
        // Hide puzzle ratings and auto-next
        const userInfosEl = document.querySelector('.puzzle-user') as HTMLElement;
        if (userInfosEl) userInfosEl.style.display = 'none';
        const infoEl = document.querySelector('.puzzle-info') as HTMLElement;
        if (infoEl) infoEl.style.display = 'none';

        // Override the hint and solution buttons
        const viewHintEl = document.querySelector('.hint') as HTMLElement;
        if (viewHintEl) patch(viewHintEl, h('div'));

        const viewSolutionEl = document.querySelector('.solution') as HTMLElement;
        if (viewSolutionEl) patch(viewSolutionEl, h('div'));

        this.renderInfos();
        this.yourTurn();
        this.afficherCible();

        // Les étapes s'enchaînent sur place : « Retour » du navigateur recharge l'étape demandée
        window.addEventListener('popstate', () => window.location.reload());

    }

    private lireEtape(data: EtapeTutoriel) {
        this.chapitre = data.chapitre || 0;
        this.chapitreNom = data.chapitre_nom || '';
        this.carte = data.carte || '';
        this.cible = data.cible || '';
        this.equipe = data.equipe || [];
        this.selection = '';
        this.total = data.total || 10;
    }

    /** La case à atteindre, entourée sur le plateau (le joueur ne connaît pas encore les noms de cases). */
    private afficherCible() {
        this.chessground.set({ drawable: { brushes: { ...this.chessground.state.drawable.brushes, cible: { key: 'ci', color: '#eac45a', opacity: 1, lineWidth: 12 } } } });
        this.chessground.setAutoShapes(this.cible ? [{ orig: this.cible as cg.Key, brush: 'cible' }] : []);
    }

    private enTete(): VNode[] {
        return [
            this.chapitreNom ? h('span.tutorial-chapitre', `Chapitre ${this.chapitre} · ${this.chapitreNom}`) : '',
            this.title ? h('h2.tutorial-title', this.title) : '',
        ] as VNode[];
    }

    private progression(): VNode[] {
        const id = this.tutorialId || parseInt(this._id);
        return [
            h('div.tutorial-progress', [h('div.tutorial-progress-bar', { style: { width: `${Math.round(id / this.total * 100)}%` } })]),
            h('span.tutorial-step-label', `Étape ${id} / ${this.total}`),
        ];
    }

    renderInfos() {
        // this.instruction is undefined when called from super() — skip early calls
        if (!this.instruction) return;
        const infosEl = document.querySelector('.infos') as HTMLElement;
        if (!infosEl) return;
        patch(infosEl, h('div.infos.tutorial-info', [
            ...this.enTete(),
            h('div.tutorial-consigne', [
                this.carte ? h('img.tutorial-carte', { attrs: { src: VIGNETTES + this.carte, alt: '' } }) : '',
                h('p.tutorial-instruction', this.instruction),
            ]),
            ...this.progression(),
        ]));
    }

    yourTurn() {
        if (!this.playerEl || !this.variant) return;

        const turnColor = this.fullfen.split(" ")[1];
        const pieceColor = (turnColor == 'w') ? 'white' : 'black';
        const kingRole = this.variant.kingRoles[0];
        
        this.playerEl = patch(this.playerEl,
            h(`div.player.${this.variant.pieceFamily}`, [
                h(`piece.${pieceColor}.no-square.${kingRole}.ally`),
                h('div.instruction', [
                    h('strong', 'À vous de jouer !'),
                ]),
            ])
        );
    }

    notTheMove(san: string) {
        this.failed = true;
        this.playerEl = patch(this.playerEl,
            h('div.player', [
                h('div.icon', '✗'),
                h('div.instruction', [
                    h('san', [san, h('span.fail', '?')]),
                    h('strong', "Ce n'est pas ce qui est demandé."),
                    h('em', 'Essayez encore.'),
                ]),
            ])
        );
        const feedbackEl = document.querySelector('.feedback') as HTMLInputElement;
        if (feedbackEl) {
            feedbackEl.classList.toggle('good', false);
            feedbackEl.classList.toggle('fail', true);
        }
    }

    bestMove() {
        // Not used heavily in single-move tutorials, but let's override it just in case
        this.playerEl = patch(this.playerEl,
            h('div.player', [
                h('div.icon', '✓'),
                h('div.instruction', [
                    h('strong', 'Bon coup !'),
                    h('em', 'Continuez…'),
                ]),
            ])
        );
    }

    puzzleComplete(success: boolean) {
        this.completed = true;
        this.chessground.setAutoShapes([]);
        const derniere = this.tutorialId >= this.total;
        noterProgression(this.tutorialId, derniere);

        // Réussite affichée dans le cadre du haut (plus de bandeau sur le plateau : tout tient à l'écran).
        // À la fin, une seule suite : la première vraie partie, contre AZAR au niveau 1.
        // Après le tutoriel : les 4 équipes de départ (/collection#equipes), puis la première partie
        const boutons = derniere ? [
            h('a.mt-btn.mt-btn-or', { attrs: { href: '/collection#equipes' } }, 'Les équipes'),
            h('a.tutorial-lien', { attrs: { href: '/jouer/solo?variant=matatakmini&level=1' } }, 'Jouer tout de suite'),
        ] : [
            h('button.mt-btn.mt-btn-or.suivante', { attrs: { type: 'button' }, on: { click: () => this.nextTutorial() } }, 'Étape suivante'),
        ];
        const infoEl = document.querySelector('.tutorial-info') as HTMLElement;
        if (infoEl) {
            patch(infoEl, h('div.infos.tutorial-info.tutorial-success', [
                h('h2.tutorial-title', derniere ? 'Tutoriel terminé !' : 'Étape réussie !'),
                h('p.tutorial-success-msg', this.successMsg),
                h('div.tutorial-actions', boutons),
                ...this.progression(),
            ]));
            this.recalerPlateau();
            // Le bouton reçoit le focus : Entrée passe à l'étape suivante
            (document.querySelector('.tutorial-actions .mt-btn') as HTMLElement | null)?.focus();
        }

        // Clear the old feedback zone
        const feedbackEl = document.querySelector('.feedback') as HTMLElement;
        if (feedbackEl) patch(feedbackEl, h('div.feedback'));

        const engineEl = document.querySelector('.engine') as HTMLElement;
        if (engineEl) engineEl.style.display = 'flex';
    }

    nextTutorial() {
        if (this.tutorialId >= this.total) {
            window.location.assign('/jouer'); // Fin du tutoriel : retour à la page de jeu
            return;
        }
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
        this._id = etape._id;
        this.tutorialId = parseInt(etape._id);
        this.instruction = etape.instruction;
        this.successMsg = etape.success_msg;
        this.title = etape.title || '';
        this.lireEtape(etape);
        this.solution = etape.moves.split(',') as UCIMove[];
        this.moves = [];
        this.ply = 0;
        this.plyVari = 0;
        this.failed = false;
        this.completed = false;
        this.posted = false;

        this.fullfen = etape.fen;
        this.turnColor = etape.fen.split(' ')[1] === 'w' ? 'white' : 'black' as cg.Color;
        this.color = this.turnColor;
        this.ffishBoard.setFen(this.fullfen);
        this.steps = [{ fen: this.fullfen, turnColor: this.turnColor, check: false, move: undefined }];

        this.chessground.set({
            fen: this.fullfen,
            turnColor: this.turnColor,
            orientation: this.turnColor,
            lastMove: uci2LastMove(undefined),
            check: false,
            movable: { color: this.turnColor },
            drawable: { shapes: [], autoShapes: [] },
        });
        this.chessground.selectSquare(null);
        this.setDests();
        updateMovelist(this);
        appliquerRois(this.assets, saisonDuCamp(this.fullfen, 'white', this._id), saisonDuCamp(this.fullfen, 'black', this._id));

        // Apparition en fondu des nouvelles pièces
        const wrap = document.querySelector('.tutorial-app .cg-wrap');
        if (wrap) {
            wrap.classList.remove('changement');
            void (wrap as HTMLElement).offsetWidth; // relance l'animation
            wrap.classList.add('changement');
        }

        const engineEl = document.querySelector('.engine') as HTMLElement;
        if (engineEl) engineEl.style.display = 'none';
        const feedbackEl = document.querySelector('.feedback') as HTMLElement;
        if (feedbackEl) patch(feedbackEl, h('div.feedback'));
        this.renderInfos();
        this.yourTurn();
        this.afficherCible();
        this.recalerPlateau();
    }

    /** Le cadre du haut change de hauteur (réussite, étape suivante) : le plateau se déplace à l'écran.
     *  chessground garde en mémoire son ancienne position et décalait alors chaque toucher d'une case
     *  (toucher TAMTAM visait une case vide, toucher BASS l'« attrapait »). */
    private recalerPlateau() {
        requestAnimationFrame(() => this.chessground.state.dom.bounds.clear());
    }
}
