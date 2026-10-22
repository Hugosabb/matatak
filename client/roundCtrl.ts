import { h, VNode } from 'snabbdom';
import { memoriserEquipe } from './equipe';
import { EcranDraft, EtatDraft } from './draft';
import { appliquerRois, roiDuNiveau, saisonDuCamp, saisonDuNiveau, Saison } from './rois';

function stockage(cle: string): string | null {
    try { return localStorage.getItem(cle); } catch { return null; }
}

import { premove } from './premoveCgOverride';
import { predrop } from 'chessgroundx/predrop';
import * as cg from 'chessgroundx/types';
import { Api } from "chessgroundx/api";

import { JSONObject } from './types';
import { _, ngettext } from './i18n';
import { patch } from './document';
import { boardSettings } from './boardSettings';
import { Clock } from './clock';
import { sound } from './sound';
import { fogFen } from "./variants";
import { WHITE, BLACK, uci2LastMove, getCounting, isHandicap } from './chess';
import { crosstableView } from './crosstable';
import { chatMessage, chatView } from './chat';
import { createMovelistButtons, updateMovelist, updateResult, selectMove } from './movelist';
import { renderRdiff, result } from './result';
import { player } from './player';
import { updateCount, updatePoint } from './info';
import { updateMaterial, emptyMaterial } from './material';
import { notify } from './notification';
import { Clocks, MsgBoard, MsgGameEnd, MsgMove, MsgNewGame, MsgUserConnected, RDiffs, CrossTable } from "./messages";
import { MsgUserDisconnected, MsgUserPresent, MsgMoreTime, MsgDrawOffer, MsgDrawRejected, MsgRematchOffer, MsgRematchRejected, MsgCount, MsgSetup, MsgGameStart, MsgViewRematch, MsgUpdateTV, MsgBerserk } from './roundType';
import { PyChessModel } from "./types";
import { GameController } from './gameCtrl';
import { handleOngoingGameEvents, Game, gameViewPlaying, compareGames } from './nowPlaying';
import { createWebsocket } from "@/socket/webSocketUtils";
import { variantsIni } from './variantsIni';
import { loadEngine } from './engineLoader';
import { setPocketRowCssVars } from './pocketRow';

let rang = false;
const CASUAL = '0';
const LVL_SKILL = [-20, -17, -14, -11, -8, -5, -3, -1, 0, 1, 3, 4, 5, 6, 7, 10, 12, 15, 17, 20];
// Temps de réflexion de l'ordinateur (Solo) : il calcule, puis attend d'avoir « réfléchi » le temps
// visé (tempsVise). Jamais instantané, jamais 10 s ; avec une pendule, il ne s'autorise qu'une petite
// part de son temps, et joue tout de suite sous 30 s (idée d'Hugo, 22/10/2026).
// Les niveaux 16 à 20 réfléchissent vraiment plus longtemps : à ce niveau, le temps de calcul fait
// la force du moteur, et un adversaire fort qui prend son temps paraît crédible (Hugo).
const REFLEXION_MAX = 5000;
const REFLEXION_MAX_FORT = 8000;
const RESERVE_PRESSE = 30 * 1000;
const LVL_DEPTHS = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7, 9, 13, 17, 22];

export class RoundController extends GameController {
    assetURL: string;
    berserked: { wberserk: boolean, bberserk: boolean };
    byoyomi: boolean;
    byoyomiPeriod: number;
    clocks: [Clock, Clock];
    clocktimes: Clocks;
    expirations: [VNode | HTMLElement, VNode | HTMLElement];
    expiStart: number;
    firstmovetime: number;
    tournamentGame: boolean;
    profileid: string;
    level: number;
    clockOn: boolean;
    materialDifference: boolean;
    vmaterial0: VNode | HTMLElement;
    vmaterial1: VNode | HTMLElement;
    vpng: VNode;
    vdialog: VNode;
    berserkable: boolean;
    settings: boolean;
    tv: boolean;
    initialFen: string;
    handicap: boolean;
    focus: boolean;
    finishedGame: boolean;
    // Fin de partie : résultat affiché et état de la revanche contre un humain
    fin: { status: number, result: string } | undefined;
    revanche: '' | 'envoyee' | 'recue' | 'refusee' = '';
    revancheId = '';
    // Téléphone : barre du bas (Options, Précédent, Suivant) et son menu
    vbarre: VNode | HTMLElement | undefined;
    menuOuvert = false;
    // Première partie sur l'appareil : conseils discrets (0 = aucun, 1 = toucher, 2 = gagner, 3 = fini)
    etapeConseil = 0;
    vconseil: VNode | HTMLElement | undefined;
    lastMaybeSentMsgMove: MsgMove | undefined; // Always store the last "move" message that was passed for sending via websocket.
    // In case of bad connection, we are never sure if it was sent (thus the name)
    isEngineReady: boolean;
    fsfDebug: boolean;
    uciOk: boolean;
    isSearching: boolean;
    mate1: boolean;
    draftPhase: string;
    // Draft (client/draft.ts) : écran avant le plateau ; Rois tirés au Draft ou gardés en revanche
    draftEcran?: EcranDraft;
    enDraft = false;
    rois: { white: Saison, black: Saison } | null = null;

    // until a "board" message from server is received from server that confirms it.
    // So if at any moment connection drops, after reconnect we always resend it.
    // If server received and processed it the first time, it will just ignore it
    private readyokCallback: (() => void) | null = null;
    onFSFline: (line: string) => void;


    constructor(el: HTMLElement, model: PyChessModel) {
        super(el, model, model.fen, document.getElementById('pocket0') as HTMLElement, document.getElementById('pocket1') as HTMLElement, '');
        this.focus = !document.hidden;
        document.addEventListener("visibilitychange", () => { this.focus = !document.hidden });
        window.addEventListener('blur', () => { this.focus = false });
        window.addEventListener('focus', () => { this.focus = true });

        const onOpen = () => {
            if (this.lastMaybeSentMsgMove && this.lastMaybeSentMsgMove.ply === this.ply + 1) {
                // if this.ply === this.lastMaybeSentMsgMove.ply it would mean the move message was received by server and it has replied with "board" message, confirming and updating the state, including this.ply
                // since they are not equal, but also one ply behind, means we should try to re-send it
                try {
                    console.log("resending unsent message ", this.lastMaybeSentMsgMove);
                    this.doSend(this.lastMaybeSentMsgMove);
                } catch (e) {
                    console.log("could not even REsend unsent message ", this.lastMaybeSentMsgMove)
                }
            }

            this.clocks[0].connecting = false;
            this.clocks[1].connecting = false;
        };

        const onReconnect = () => {
            if (this.finishedGame) {
                // Prevent endless reconnections from finished games
                this.sock.close();
                return
            }
            this.clocks[0].connecting = true;
            this.clocks[1].connecting = true;
            console.log('Reconnecting in round...');

            const container = document.getElementById('player1') as HTMLElement;
            patch(container, h('i-side#player1.online', { class: { "icon": true, "icon-online": false, "icon-offline": true } }));
        };

        this.sock = createWebsocket('wsr/' + this.gameId, onOpen, onReconnect, () => { }, (e: MessageEvent) => this.onMessage(e));

        this.assetURL = model["assetURL"];
        this.byoyomiPeriod = Number(model["byo"]);
        this.byoyomi = this.variant.rules.defaultTimeControl === 'byoyomi';
        this.finishedGame = this.status >= 0;
        // Téléphone : l'en-tête du site est masqué pendant la partie d'un joueur (partie.css), rendu à la fin
        document.body.classList.toggle('en-partie', !this.spectator && !this.finishedGame);
        this.tv = model["tv"];
        this.profileid = model["profileid"];
        this.level = model["level"];
        this.berserked = { wberserk: model["wberserk"] === "True", bberserk: model["bberserk"] === "True" };

        this.initialFen = model["initialFen"];
        console.log("initialFen : ", this.initialFen);
        if (!this.spectator) memoriserEquipe(this.variant.name, this.initialFen, this.mycolor);
        this.appliquerLesRois();

        this.settings = true;
        this.autoPromote = localStorage.autoPromote === undefined ? false : localStorage.autoPromote === "true";
        this.materialDifference = localStorage.materialDifference === undefined ? false : localStorage.materialDifference === "true";

        this.handicap = this.variant.alternateStart ? Object.keys(this.variant.alternateStart!).some(alt => isHandicap(alt) && this.variant.alternateStart![alt] === this.fullfen) : false;

        this.preaction = false;

        this.onFSFline = (line: string) => {
            if (this.fsfDebug) console.log(`FSF> ${line}`);
            if (line.startsWith('bestmove')) {
                const bestMove = line.split(' ')[1];
                if (bestMove && bestMove !== '(none)' && !this.mate1) {
                    this.jouerCoupOrdinateur(bestMove);
                } else if (!this.mate1) {
                    this.marquerReflexion(false);
                }
            } else if (line.split(' ')[8] == 'mate' // avoid FSF not finishing the game for severals moves even if obvious win
                && line.split(' ')[2] != '0'
                && line.startsWith('info depth ')
                && line.split(' ')[9] == '1'
                && !this.mate1) {
                const mate1 = line.split(' ')[19];
                this.mate1 = true;
                this.jouerCoupOrdinateur(mate1);
            } else if (line.startsWith('Fairy-Stockfish')) {
                window.prompt = function () {
                    return variantsIni + '\nEOF';
                }
                this.fsfPostMessage('load <<EOF');
                this.fsfPostMessage('uci');
            } else if (line.includes('readyok') && this.readyokCallback) {
                this.isEngineReady = true;
                this.readyokCallback();
            }
            else if (line.startsWith('option name UCI_Variant')) {
                if (!line.includes(this.variant.name)) {
                    console.log(this.variant.name, line);
                    console.log('WARNING This variant is NOT supported by Fairy-Stockfish!');
                    return;
                } else {
                    console.log(this.variant.name, 'is supported by Fairy-Stockfish!');
                }
            }
            else if (line.includes('uciok')) {
                this.uciOk = true;
                this.isEngineReady = true;
                this.searchBestMove();
            }
        };

        this.tournamentGame = this.tournamentId !== '';

        this.isEngineReady = false;
        this.fsfDebug = true;
        this.uciOk = false;
        this.isSearching = false;
        this.mate1 = false;
        this.draftPhase = "";
        loadEngine().then(() => {
            console.log('Fairy-Stockfish engine loaded for round.');
            //setInterval(() => this.searchBestMove(), 3000);
            this.connectFsf();
        }).catch(console.error);

        const parts = this.fullfen.split(" ");
        this.clockOn = (Number(parts[parts.length - 1]) >= 2) && !this.corr;

        const berserkId = (this.mycolor === "white") ? "wberserk" : "bberserk";
        // Not berserked yet, but allowed to do it
        this.berserkable = !this.spectator && this.tournamentGame && this.base > 0 && !this.berserked[berserkId];

        this.chessground.set({
            orientation: this.variant.name === 'racingkings' ? 'white' : this.mycolor,
            turnColor: this.turnColor,
            autoCastle: this.variant.name !== 'cambodian', // TODO make more generic
        });

        if (this.spectator) {
            this.chessground.set({
                //viewOnly: false,
                movable: { free: false, color: undefined },
                draggable: { enabled: false },
                premovable: { enabled: false },
                events: { move: this.onMove() }
            });
        } else {
            this.chessground.set({
                movable: {
                    free: false,
                    color: (this.variant.rules.setup && this.status === -2) ? undefined : this.mycolor,
                    events: {
                        after: (orig, dest, meta) => this.onUserMove(orig, dest, meta),
                        afterNewPiece: (piece, dest, meta) => this.onUserDrop(piece, dest, meta),
                    }
                },
                premovable: {
                    enabled: false,
                    premoveFunc: premove(this.variant.name, this.chess960, this.variant.board.dimensions),
                    predropFunc: predrop(this.variant.name, this.variant.board.dimensions),
                    events: {
                        set: this.setPremove,
                        unset: this.unsetPremove,
                    }
                },
                events: {
                    move: this.onMove(),
                    dropNewPiece: this.onDrop(),
                    select: this.onSelect(),
                },
            });
        }

        if (this.hasPockets) {
            setPocketRowCssVars(this);
        }

        this.updatePocketsVisibility(this.draftPhase);

        // initialize users
        const player0 = document.getElementById('rplayer0') as HTMLElement;
        const player1 = document.getElementById('rplayer1') as HTMLElement;
        this.vplayer0 = patch(player0, player('player0', this.titles[0], this.players[0], this.ratings[0], this.level));
        this.vplayer1 = patch(player1, player('player1', this.titles[1], this.players[1], this.ratings[1], this.level));

        if (this.variant.material.showDiff) {
            const materialTop = document.querySelector('.material-top') as HTMLElement;
            const materialBottom = document.querySelector('.material-bottom') as HTMLElement;
            this.vmaterial0 = this.mycolor === 'white' ? materialBottom : materialTop;
            this.vmaterial1 = this.mycolor === 'black' ? materialBottom : materialTop;
            this.updateMaterial();
        }

        // initialize expirations
        this.expirations = [
            document.getElementById('expiration-top') as HTMLElement,
            document.getElementById('expiration-bottom') as HTMLElement
        ];

        this.clocktimes = [this.base * 1000 * 60, this.base * 1000 * 60]

        // initialize clocks
        if (this.corr) {
            const c0 = new Clock(this.base, 0, 0, document.getElementById('clock0') as HTMLElement, 'clock0', true);
            const c1 = new Clock(this.base, 0, 0, document.getElementById('clock1') as HTMLElement, 'clock1', true);
            this.clocks = [c0, c1];

            this.clocks[0].onTick(this.clocks[0].renderTime);
            this.clocks[1].onTick(this.clocks[1].renderTime);

        } else {

            const c0 = new Clock(this.base, this.inc, this.byoyomiPeriod, document.getElementById('clock0') as HTMLElement, 'clock0', false);
            const c1 = new Clock(this.base, this.inc, this.byoyomiPeriod, document.getElementById('clock1') as HTMLElement, 'clock1', false);
            this.clocks = [c0, c1];

            // If player berserked, set increment to 0. Actual clock duration value will be set by onMsgBoard()
            const bclock = this.mycolor === "black" ? 1 : 0;
            const wclock = 1 - bclock;
            if (this.berserked['wberserk']) this.clocks[wclock].increment = 0;
            if (this.berserked['bberserk']) this.clocks[bclock].increment = 0;

            this.clocks[0].onTick(this.clocks[0].renderTime);
            this.clocks[1].onTick(this.clocks[1].renderTime);

            const onMoreTime = () => {
                if (this.wtitle === 'BOT' || this.btitle === 'BOT' || this.spectator || this.status >= 0 || this.flipped()) return;
                const clockIdx = (this.flipped()) ? 1 : 0;
                this.clocks[clockIdx].setTime(this.clocks[clockIdx].duration + 15 * 1000);
                this.doSend({ type: "moretime", gameId: this.gameId });
                const oppName = (this.username === this.wplayer) ? this.bplayer : this.wplayer;
                chatMessage('', oppName + _(' +15 seconds'), "roundchat");
            }

            if (!this.spectator && !this.unlimited && this.rated === CASUAL && ![this.wtitle, this.btitle].some(t => t === 'BOT' || t === 'LIA')) {
                const container = document.getElementById('more-time') as HTMLElement;
                patch(container, h('div#more-time', [
                    h('button.icon.icon-plus-square', {
                        props: { type: "button", title: _("Give 15 seconds") },
                        on: { click: () => onMoreTime() }
                    })
                ]));
            }

            const onBerserk = () => {
                if (this.berserkable) {
                    this.berserkable = false;
                    this.berserk(this.mycolor);
                    this.doSend({ type: "berserk", gameId: this.gameId, color: this.mycolor });
                }
            }

            if (this.berserkable && this.status < 0 && this.ply < 2) {
                const container = document.getElementById('berserk1') as HTMLElement;
                patch(container, h('div#berserk1', [
                    h('button.icon.icon-berserk', {
                        props: { type: "button", title: _("Berserk") },
                        on: { click: () => onBerserk() }
                    })
                ]));
            }
        }

        // initialize crosstable
        this.ctableContainer = document.querySelector('.ctable-container') as HTMLElement;

        if (model["ct"]) {
            this.ctableContainer = patch(this.ctableContainer, h('div.ctable-container'));
            this.ctableContainer = patch(this.ctableContainer, crosstableView(model["ct"] as CrossTable, this.gameId));
            const panel3 = document.querySelector('.ctable-container') as HTMLElement;
            panel3.style.display = 'block';
        }

        const misc0 = document.getElementById('misc-info0') as HTMLElement;
        const misc1 = document.getElementById('misc-info1') as HTMLElement;

        // initialize material point and counting indicator
        if (this.variant.ui.materialPoint || this.variant.ui.counting) {
            this.vmiscInfoW = this.mycolor === 'white' ? patch(misc1, h('div#misc-infow')) : patch(misc0, h('div#misc-infow'));
            this.vmiscInfoB = this.mycolor === 'black' ? patch(misc1, h('div#misc-infob')) : patch(misc0, h('div#misc-infob'));
        }

        const flagCallback = () => {
            if (this.unlimited) return;
            if (this.turnColor === this.mycolor) {
                this.chessground.stop();
                // console.log("Flag");
                this.doSend({ type: "flag", gameId: this.gameId });
            }
        }

        const byoyomiCallback = () => {
            if (this.turnColor === this.mycolor) {
                // console.log("Byoyomi", this.clocks[1].byoyomiPeriod);
                const oppclock = !this.flipped() ? 0 : 1;
                const myclock = 1 - oppclock;
                this.doSend({ type: "byoyomi", gameId: this.gameId, color: this.mycolor, period: this.clocks[myclock].byoyomiPeriod });
            }
        }

        if (!this.spectator && !this.corr) {
            if (this.byoyomiPeriod > 0) {
                this.clocks[0].onByoyomi(byoyomiCallback);
                this.clocks[1].onByoyomi(byoyomiCallback);
            }
            this.clocks[0].onFlag(flagCallback);
            this.clocks[1].onFlag(flagCallback);
        }

        const container = document.getElementById('game-controls') as HTMLElement;
        if (!this.spectator) {
            let buttons = [];
            if (this.variant.rules.duck) {
                buttons.push(h('div#undo'));
            }
            if (!this.tournamentGame) {
                buttons.push(this.buttonAbort());
            }
            buttons.push(h('button#count', _('Count')));
            if (this.variant.rules.pass) {
                buttons.push(h('button#draw', { on: { click: () => this.pass() }, props: { title: _('Pass') } }, _('Pass')));
            } else if (!this.variant.rules.noDrawOffer) {
                buttons.push(h('button#draw', { on: { click: () => this.draw() }, props: { title: _('Draw') } }, h('i', '½')));
            }
            buttons.push(h('button#resign', { on: { click: () => this.resign() }, props: { title: _("Resign") } }, [h('i', { class: { "icon": true, "icon-flag-o": true } }),]));

            this.gameControls = patch(container, h('div.btn-controls.game', buttons));

            const manualCount = this.variant.ui.counting === 'makruk' && !(this.wtitle === 'BOT' || this.btitle === 'BOT');
            if (!manualCount)
                patch(document.getElementById('count') as HTMLElement, h('div'));
            if (this.corr) {
                const drawEl = document.getElementById("draw") as HTMLInputElement;
                if (drawEl) drawEl.disabled = true;
                const resignEl = document.getElementById("resign") as HTMLInputElement;
                if (resignEl) resignEl.disabled = true;
            }
        } else {
            this.gameControls = patch(container, h('div.btn-controls.game'));
        }

        createMovelistButtons(this);
        this.vmovelist = document.getElementById('movelist') as HTMLElement;
        this.vbarre = document.getElementById('barre-partie') as HTMLElement;
        if (!this.spectator && this.status < 0 && !stockage('matatak_conseils')) this.etapeConseil = 1;
        this.renderBarre();

        this.vdialog = patch(document.getElementById('offer-dialog')!, h('div#offer-dialog', ""));

        patch(document.getElementById('roundchat') as HTMLElement, chatView(this, "roundchat"));

        boardSettings.assetURL = this.assetURL;
        boardSettings.updateBoardAndPieceStyles();

        if (this.corr && model.corrGames.length > 0) {
            const corrGames = JSON.parse(model.corrGames).sort(compareGames(this.username));
            const cgMap: { [gameId: string]: [Api, string] } = {};
            handleOngoingGameEvents(this.username, cgMap);

            patch(document.querySelector('.games-container') as HTMLElement,
                h('games-grid#games', corrGames.flatMap((game: Game) => {
                    if (game.gameId === this.gameId) {
                        return [];
                    } else {
                        return [gameViewPlaying(cgMap, game, this.username)];
                    }
                }))
            )
        }

        this.onMsgBoard(model["board"] as MsgBoard);
    }

    toggleSettings() {
    }

    /** Pastille de conseil de la première partie (même style que « Connexion… »), jamais bloquante. */
    private renderConseil() {
        if (this.etapeConseil === 0 || this.etapeConseil >= 3) {
            document.getElementById('conseil')?.remove();
            this.vconseil = undefined;
            return;
        }
        if (!this.vconseil) {
            this.vconseil = document.createElement('div');
            document.body.appendChild(this.vconseil);
        }
        const regles = this.etapeConseil === 1 && !['fini', 'connu'].includes(stockage('matatak_tutoriel') ?? '');
        this.vconseil = patch(this.vconseil, h('div#conseil', { attrs: { role: 'status' } }, [
            h('span.losange'),
            h('span', this.etapeConseil === 1
                ? 'Touchez un Personnage pour voir où il peut aller.'
                : 'Pour gagner : votre Roi sur la Colline, ou échec et mat.'),
            regles ? h('a', { attrs: { href: '/tutorial/1', target: '_blank', rel: 'noopener' } }, 'Les règles en 2 min') : '',
            h('button', { attrs: { type: 'button', 'aria-label': 'Fermer' }, on: { click: () => this.finConseils() } }, '×'),
        ]));
    }

    private finConseils() {
        this.etapeConseil = 3;
        try { localStorage.setItem('matatak_conseils', 'vus'); } catch { /* navigation privée */ }
        this.renderConseil();
    }

    /** Barre du bas sur téléphone (partie.css), comme les applis d'échecs : les actions rares
     *  (annuler, match nul, abandon) sont dans un menu, pas sous le pouce. */
    private renderBarre = () => {
        if (!this.vbarre) return;
        const enCours = !this.spectator && this.status < 0;
        const coupsJoues = this.steps.length - 1;
        // Conseils de la première partie : « toucher » jusqu'au premier coup, puis « gagner » quelques coups
        if (this.etapeConseil === 1 && coupsJoues >= 1) this.etapeConseil = 2;
        if (this.etapeConseil === 2 && (coupsJoues >= 5 || !enCours)) this.finConseils();
        else this.renderConseil();
        const fermer = () => { this.menuOuvert = false; this.renderBarre(); };
        const action = (texte: string, faire: () => void, attention = false) =>
            h('button.barre-action', { class: { attention }, attrs: { type: 'button', role: 'menuitem' }, on: { click: () => { fermer(); faire(); } } }, texte);
        const actions: VNode[] = [];
        if (enCours) {
            if (coupsJoues < 2 && !this.tournamentGame) actions.push(action('Annuler la partie', () => this.abort()));
            else if (!this.variant.rules.noDrawOffer) actions.push(action('Proposer match nul', () => this.draw()));
            if (coupsJoues >= 2 || this.tournamentGame) actions.push(action('Abandonner', () => this.resign(), true));
        }
        // Icônes seules (barre plus basse, plateau plus grand) ; le nom reste pour les lecteurs d'écran
        const icone = (d: string, epaisseur = '2.4') => h('svg', { attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': epaisseur, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' } }, [h('path', { attrs: { d } })]);
        const bouton = (texte: string, svg: VNode, onClick: () => void, attrs: Record<string, string> = {}) =>
            h('button.barre-btn', { attrs: { type: 'button', 'aria-label': texte, title: texte, ...attrs }, on: { click: onClick } }, [svg]);
        // Rien à proposer (partie finie, spectateur) : pas de bouton Options
        if (!actions.length) this.menuOuvert = false;
        this.vbarre = patch(this.vbarre, h('div#barre-partie', { class: { ouvert: this.menuOuvert, 'sans-options': !actions.length } }, [
            this.menuOuvert ? h('div.barre-fond', { on: { click: fermer } }) : '',
            this.menuOuvert ? h('div.barre-menu', { attrs: { role: 'menu' } }, actions) : '',
            actions.length ? bouton('Menu de la partie', icone('M5 12h.01M12 12h.01M19 12h.01', '4'), () => { this.menuOuvert = !this.menuOuvert; this.renderBarre(); },
                { 'aria-expanded': String(this.menuOuvert), 'aria-haspopup': 'menu' }) : '',
            bouton('Coup précédent', icone('M15 5l-7 7 7 7'), () => selectMove(this, this.ply - 1)),
            bouton('Coup suivant', icone('M9 5l7 7-7 7'), () => selectMove(this, this.ply + 1)),
        ]));
    }

    buttonAbort() {
        return h('button#abort', { on: { click: () => this.abort() }, props: { title: _('Abort') } }, [h('i', { class: { "icon": true, "icon-abort": true } }),]);
    }

    toggleOrientation() {
        // TODO: handle berserk
        if (this.tournamentGame && this.ply < 2 && !this.spectator) return;

        super.toggleOrientation()

        boardSettings.updateDropSuggestion();

        // console.log("FLIP");
        if (this.variant.material.showDiff) {
            this.updateMaterial();
        }

        if (this.hasPockets) {
            setPocketRowCssVars(this);
        }

        // const pocketTop = document.querySelector('.pocket-top') as HTMLElement;
        // const pocketBottom = document.querySelector('.pocket-bot') as HTMLElement;

        // if (pocketTop && pocketBottom) {
        //     if ((this.variant.name === 'matatak') == (this.draftPhase === 'CUT')) {
        //         // Si oui, on affiche les poches
        //         pocketTop.style.display = 'block';
        //         pocketBottom.style.display = 'block';
        //         // Et on configure leur layout correctement
        //         setPocketRowCssVars(this); 
        //     } else {
        //         // Sinon, on les cache
        //         pocketTop.style.display = 'none';
        //         pocketBottom.style.display = 'none';
        //     }
        // }

        // TODO: moretime button
        const new_running_clck = (this.clocks[0].running) ? this.clocks[1] : this.clocks[0];
        this.clocks[0].pause(false);
        this.clocks[1].pause(false);

        const tmp_clock = this.clocks[0];
        const tmp_clock_time = tmp_clock.duration;
        this.clocks[0].setTime(this.clocks[1].duration);
        this.clocks[1].setTime(tmp_clock_time);
        if (this.status < 0 && !this.unlimited) new_running_clck.start();

        this.vplayer0 = patch(this.vplayer0, player('player0', this.titles[this.flipped() ? 1 : 0], this.players[this.flipped() ? 1 : 0], this.ratings[this.flipped() ? 1 : 0], this.level));
        this.vplayer1 = patch(this.vplayer1, player('player1', this.titles[this.flipped() ? 0 : 1], this.players[this.flipped() ? 0 : 1], this.ratings[this.flipped() ? 0 : 1], this.level));

        if (this.variant.ui.counting)
            [this.vmiscInfoW, this.vmiscInfoB] = updateCount(this.fullfen, this.vmiscInfoB, this.vmiscInfoW);

        if (this.variant.ui.materialPoint)
            [this.vmiscInfoW, this.vmiscInfoB] = updatePoint(this.variant, this.fullfen, this.vmiscInfoB, this.vmiscInfoW);

        if (this.variant.material.showDiff) {
            this.updateMaterial();
        }
    }

    private berserk = (color: cg.Color) => {
        let bclock;
        if (!this.flipped()) {
            bclock = this.mycolor === "black" ? 1 : 0;
        } else {
            bclock = this.mycolor === "black" ? 0 : 1;
        }
        const wclock = 1 - bclock
        const clockIdx = (color === 'white') ? wclock : bclock;

        this.clocks[clockIdx].increment = 0;
        this.clocks[clockIdx].setTime(this.base * 1000 * 30);
        this.clocktimes[(color === 'white') ? WHITE : BLACK] = this.base * 1000 * 30;
        sound.berserk();

        const berserkId = (color === "white") ? "wberserk" : "bberserk";
        this.berserked[berserkId] = true;
        const infoContainer = document.getElementById(berserkId) as HTMLElement;
        if (infoContainer) patch(infoContainer, h('icon.icon-berserk'));

        const container = document.getElementById(`berserk${clockIdx}`) as HTMLElement;
        patch(container, h(`div#berserk${clockIdx}.berserked`, [h('button.icon.icon-berserk')]));
    }

    undo = () => {
        this.goPly(this.ply);
    }

    private abort = () => {
        this.doSend({ type: "abort", gameId: this.gameId });
    }

    private takeback = () => {
        this.doSend({ type: "takeback", gameId: this.gameId });
    }

    private draw = () => {
        if (confirm(_('Are you sure you want to draw?'))) {
            this.doSend({ type: "draw", gameId: this.gameId });
            this.setDialog(_("Draw offer sent"));
        }
    }

    private rejectDrawOffer = () => {
        this.doSend({ type: "reject_draw", gameId: this.gameId });
        this.clearDialog();
    }

    private renderDrawOffer = () => {
        (document.querySelector('.btn-controls.game') as HTMLElement).style.display = "none";
        this.vdialog = patch(this.vdialog, h('div#offer-dialog', [
            h('div.dcontrols', [
                h('div', { class: { reject: true }, on: { click: () => this.rejectDrawOffer() } }, h('i.icon.icon-abort.reject')),
                h('div.text', _("Your opponent offers a draw")),
                h('div', { class: { accept: true }, on: { click: () => this.draw() } }, h('i.icon.icon-check')),
            ])
        ]));
    }

    private rejectCorrMove = () => {
        this.undo();
        this.clearDialog();
    }

    private renderConfirmCorrMove = (callback: any, move: string) => {
        (document.querySelector('.btn-controls.game') as HTMLElement).style.display = "none";
        this.vdialog = patch(this.vdialog, h('div#offer-dialog', [
            h('div.dcontrols', [
                h('div', { class: { reject: true }, on: { click: () => this.rejectCorrMove() } }, h('i.icon.icon-abort.reject')),
                h('div.text', _("Confirm move")),
                h('div', { class: { accept: true }, on: { click: () => callback(move) } }, h('i.icon.icon-check')),
            ])
        ]));
    }

    private setDialog = (message: string) => {
        const gameControlsEl = document.querySelector('.btn-controls.game') as HTMLElement;
        if (gameControlsEl) gameControlsEl.style.display = "none";

        this.vdialog = patch(this.vdialog, h('div#offer-dialog', [
            h('div.dcontrols', [
                h('div', { class: { reject: false } }),
                h('div.text', message),
                h('div', { class: { accept: false } }),
            ])
        ]));
        setTimeout(() => this.clearDialog(), 2000);
    }

    private clearDialog = () => {
        this.vdialog = patch(this.vdialog, h('div#offer-dialog', []));
        const el = document.querySelector('.btn-controls.game') as HTMLElement;
        if (el) el.style.display = "flex";
    }

    private resign = () => {
        const doResign = (localStorage.getItem("confirmresign") === "false") || confirm(_('Are you sure you want to resign?'))
        if (doResign) {
            this.doSend({ type: "resign", gameId: this.gameId });
        }
    }

    // Janggi second player (Red) setup
    private onMsgSetup = (msg: MsgSetup) => {
        if (this.variant.name === 'janggi') {
            const buttonEl = document.getElementById('flipLeft') as HTMLElement;
            if (buttonEl !== null) return;

            this.setupFen = msg.fen;
            this.chessground.set({ fen: this.setupFen });

            const side = (msg.color === 'white') ? _('Blue (Cho)') : _('Red (Han)');
            const message = _('Waiting for %1 to choose starting positions of the horses and elephants...', side);

            this.expiStart = 0;
            this.renderExpiration();
            this.turnColor = msg.color;
            this.expiStart = Date.now();
            setTimeout(this.showExpiration, 350);

            if (this.spectator || msg.color !== this.mycolor) {
                chatMessage('', message, "roundchat");
                return;
            }

            chatMessage('_server', message, "roundchat");

            const message1 = _('You can use the arrow buttons (below the board -- scroll down to display) to switch them, then click on the check mark to finalize your decision.');
            chatMessage('_server', message1, "roundchat");

            const message2 = _('To start the game you have to click on the check mark!');
            chatMessage('_server', message2, "roundchat");

            const switchLetters = (side: number) => {
                const white = this.mycolor === 'white';
                const rank = (white) ? 9 : 0;
                const horse = (white) ? 'N' : 'n';
                const elephant = (white) ? 'B' : 'b';
                const parts = this.setupFen.split(' ')[0].split('/');
                let [left, right] = parts[rank].split('1')
                if (side === -1) {
                    left = left.replace(horse, '*').replace(elephant, horse).replace('*', elephant);
                } else {
                    right = right.replace(horse, '*').replace(elephant, horse).replace('*', elephant);
                }
                parts[rank] = left + '1' + right;
                this.setupFen = parts.join('/') + ' w - - 0 1';
                this.chessground.set({ fen: this.setupFen });
            }

            const sendSetup = () => {
                patch(document.getElementById('janggi-setup-buttons') as HTMLElement, h('div#empty'));
                this.doSend({ type: "setup", gameId: this.gameId, color: this.mycolor, fen: this.setupFen });
            }

            const leftSide = (this.mycolor === 'white') ? -1 : 1;
            const rightSide = leftSide * -1;
            patch(document.getElementById('janggi-setup-buttons') as HTMLElement, h('div#janggi-setup-buttons', [
                h('button#flipLeft', { on: { click: () => switchLetters(leftSide) } }, [h('i', { props: { title: _('Switch pieces') }, class: { "icon": true, "icon-exchange": true } }),]),
                h('button', { on: { click: () => sendSetup() } }, [h('i', { props: { title: _('Ready') }, class: { "icon": true, "icon-check": true } }),]),
                h('button#flipRight', { on: { click: () => switchLetters(rightSide) } }, [h('i', { props: { title: _('Switch pieces') }, class: { "icon": true, "icon-exchange": true } }),]),
            ]));
        }
    }

    private resetForNewPhase(msg: { fen: cg.FEN, status: number }) {
        console.log("Resetting RoundController for new game phase.");

        // 1. Réinitialiser l'état du jeu de base
        this.ply = 0;
        this.status = msg.status;
        this.finishedGame = false;
        this.lastMaybeSentMsgMove = undefined;

        // 2. Mettre à jour le FEN initial et actuel
        // C'est l'étape la plus critique pour que le moteur et l'affichage soient synchronisés.
        this.initialFen = msg.fen;
        this.fullfen = msg.fen;
        // Fin du Draft : l'équipe composée devient celle qu'on peut garder
        if (!this.spectator) memoriserEquipe(this.variant.name, this.initialFen, this.mycolor);
        this.appliquerLesRois();

        // 3. Réinitialiser l'historique des coups (steps)
        this.steps = [{
            'fen': this.fullfen,
            'move': undefined,
            'check': false,
            'turnColor': this.turnColor,
        }];

        // 4. Mettre à jour l'échiquier visuel (chessground)
        const parts = msg.fen.split(" ");
        this.turnColor = parts[1] === "w" ? "white" : "black";
        this.chessground.set({
            fen: this.fullfen,
            turnColor: this.turnColor,
            lastMove: undefined,
            check: false, // La nouvelle phase commence sans échec
            movable: {
                color: this.mycolor, // Redonner la main au joueur si c'est son tour
                dests: undefined, // Les destinations seront recalculées
            },
        });

        // 5. Mettre à jour l'état du moteur ffish.js
        if (this.ffishBoard) {
            this.ffishBoard.setFen(this.fullfen);
            this.setDests(); // Recalculer les coups légaux pour la nouvelle position
        }

        // 6. Réinitialiser l'affichage
        // Vider la liste des coups
        updateMovelist(this, true, true, false);

        // Réinitialiser les affichages de matériel et autres infos
        if (this.variant.material.showDiff) {
            this.updateMaterial();
        }
        if (this.variant.ui.counting) {
            this.updateCount(this.fullfen);
        }
        this.clearDialog(); // Cacher les dialogues d'offre (nulle, etc.)
    }

    private notifyMsg = (msg: string) => {
        if (this.status >= 0) return;

        const opp_name = this.username === this.wplayer ? this.bplayer : this.wplayer;
        const logoUrl = `${this.home}/static/favicon/android-icon-192x192.png`;
        notify('matatak.org', { body: `${opp_name}\n${msg}`, icon: logoUrl });
    }

    private onMsgBerserk = (msg: MsgBerserk) => {
        if (!this.spectator && msg['color'] === this.mycolor) return;
        this.berserk(msg['color'])
    }

    private onMsgGameStart = (msg: MsgGameStart) => {
        // console.log("got gameStart msg:", msg);
        if (msg.gameId !== this.gameId) return;
        if (!this.spectator) {
            sound.genericNotify();
            if (!this.focus) this.notifyMsg('joined the game.');
        }
    }

    private onMsgNewGame = (msg: MsgNewGame) => {
        window.location.assign(this.home + '/' + msg["gameId"]);
    }

    private onMsgViewRematch = (msg: MsgViewRematch) => {
        this.revancheId = msg["gameId"];
        this.renderFin();
    }

    private rematch = (level?: number, nouveauDraft = false) => {
        this.doSend({ type: "rematch", gameId: this.gameId, handicap: this.handicap, level: level ?? this.level, nouveau_draft: nouveauDraft });
        // Contre l'IA, la nouvelle partie s'ouvre aussitôt (message new_game) : rien à attendre.
        if (!this.contreIA()) {
            this.revanche = 'envoyee';
            this.renderFin();
        }
    }

    private rejectRematchOffer = () => {
        this.doSend({ type: "reject_rematch", gameId: this.gameId });
        this.revanche = '';
        this.renderFin();
    }

    private renderRematchOffer = () => {
        this.revanche = 'recue';
        this.renderFin();
    }

    private analysis = (home: string) => {
        window.location.assign(home + '/' + this.gameId + '?ply=' + this.ply.toString());
    }

    private joinTournament = () => {
        window.location.assign(this.home + '/tournament/' + this.tournamentId);
    }

    private pauseTournament = () => {
        window.location.assign(this.home + '/tournament/' + this.tournamentId + '/pause');
    }

    private gameOver = (rdiffs: RDiffs) => {
        let container;
        container = document.getElementById('wrdiff') as HTMLElement;
        if (container) patch(container, renderRdiff(rdiffs["wrdiff"]));

        container = document.getElementById('brdiff') as HTMLElement;
        if (container) patch(container, renderRdiff(rdiffs["brdiff"]));

    }

    /** Roi de chaque camp assorti à son équipe ; en Solo, l'ordinateur a le Roi de son palier. */
    private appliquerLesRois() {
        if (!this.variant.name.startsWith('matatak')) return;
        if (this.rois) {
            appliquerRois(this.assetURL, this.rois.white, this.rois.black);
            return;
        }
        const saison = (couleur: 'white' | 'black') =>
            ((couleur === 'white' ? this.wtitle : this.btitle) === 'LIA' && this.level > 0)
                ? saisonDuNiveau(this.level)
                : saisonDuCamp(this.initialFen, couleur, this.gameId);
        appliquerRois(this.assetURL, saison('white'), saison('black'));
    }

    /** Nom affiché d'un joueur : l'ordinateur prend le nom du Roi de son palier (Solo). */
    private nomJoueur(couleur: 'white' | 'black'): string {
        const titre = couleur === 'white' ? this.wtitle : this.btitle;
        if (titre === 'LIA' && this.level > 0) return roiDuNiveau(this.level);
        return (couleur === 'white' ? this.wplayer : this.bplayer).split('#')[0];
    }

    private onMsgDraft(msg: { gameId: string, etat: EtatDraft }) {
        if (msg.gameId !== this.gameId) return;
        if (!this.draftEcran) {
            if (msg.etat.phase === 'FINI') return; // Draft déjà fini : la partie est là
            this.enDraft = true;
            this.draftEcran = new EcranDraft(document.getElementById('draft-ecran') as HTMLElement, {
                mycolor: this.mycolor,
                spectateur: this.spectator,
                nom: (c) => this.nomJoueur(c),
                assetURL: this.assetURL,
                envoyer: (m) => this.doSend({ type: 'draft', gameId: this.gameId, ...m }),
                fini: (etat) => this.finDuDraft(etat),
            });
        }
        this.draftEcran.recevoir(msg.etat);
    }

    private finDuDraft(etat: EtatDraft) {
        this.enDraft = false;
        this.rois = { white: etat.equipes.white!.roi, black: etat.equipes.black!.roi };
        this.resetForNewPhase({ fen: etat.fen!, status: -2 });
        // Le plateau était caché : chessground doit remesurer ses cases
        this.chessground.state.dom.bounds.clear();
        this.chessground.redrawAll();
        // Contre l'ordinateur, s'il a les Blancs, il joue maintenant
        if (this.contreIA()) this.searchBestMove();
    }

    private contreIA() {
        return Boolean(this.level && this.level > 0) && [this.wtitle, this.btitle].includes('LIA');
    }

    /** Phrase de fin, vue par le joueur (ou neutre pour un spectateur). */
    private raisonFin(status: number, res: string, gagne: boolean, perdu: boolean): string {
        switch (status) {
            case 0: return 'La partie a été annulée.';
            case 1: return gagne ? 'Échec et mat !' : perdu ? 'Votre Roi est échec et mat.' : 'Échec et mat.';
            case 2: return gagne ? 'Votre adversaire abandonne.' : perdu ? 'Vous avez abandonné.' : 'Abandon.';
            case 3: return gagne ? 'Patatrak ! Vous ne pouviez plus bouger : vous gagnez.'
                : perdu ? 'Patatrak ! Votre adversaire ne pouvait plus bouger : il gagne.' : 'Patatrak : le joueur bloqué gagne.';
            case 4:
            case 6: return gagne ? "Votre adversaire n'a plus de temps." : perdu ? 'Temps écoulé.' : 'Temps écoulé.';
            case 5: return 'Partie nulle.';
            case 7: return gagne ? 'Votre adversaire a quitté la partie.' : perdu ? 'Vous avez quitté la partie.' : 'Un joueur a quitté la partie.';
            case 12: return gagne ? 'Votre Roi a atteint la Colline !' : perdu ? 'Le Roi adverse a atteint la Colline.' : 'Un Roi a atteint la Colline.';
            case 13: return 'Position répétée : partie nulle.';
            default: return result(this.variant, status, res);
        }
    }

    /** Cadre de fin de partie, à la place des boutons de jeu : un résultat, une action principale, le reste en liens. */
    private renderFin = () => {
        const fin = this.fin;
        if (!fin) return;
        const gagne = (fin.result === '1-0' && this.mycolor === 'white') || (fin.result === '0-1' && this.mycolor === 'black');
        const perdu = (fin.result === '1-0' && this.mycolor === 'black') || (fin.result === '0-1' && this.mycolor === 'white');
        const nul = fin.result === '1/2-1/2';
        const joueur = !this.spectator;
        // Une première partie terminée : /jouer peut proposer d'installer l'appli (lobby.ts)
        if (joueur && fin.status !== 0) {
            try { localStorage.setItem('matatak_partie_finie', '1'); } catch { /* navigation privée */ }
        }

        let titre: string;
        if (fin.status === 0) titre = 'Partie annulée';
        else if (joueur) titre = gagne ? 'Victoire !' : perdu ? 'Défaite' : nul ? 'Égalité' : 'Partie terminée';
        else titre = fin.result === '1-0' ? 'Les Blancs gagnent' : fin.result === '0-1' ? 'Les Noirs gagnent' : nul ? 'Égalité' : 'Partie terminée';

        const lien = (texte: string, onClick: () => void) => h('button.fin-lien', { attrs: { type: 'button' }, on: { click: onClick } }, texte);
        let principal: VNode | null = null;
        let message: string | null = null;
        const liens: VNode[] = [];

        if (joueur && this.tournamentGame) {
            principal = h('button.mt-btn.mt-btn-or', { attrs: { type: 'button' }, on: { click: () => this.joinTournament() } }, 'Retour au tournoi');
            liens.push(lien('Pause', () => this.pauseTournament()));
        } else if (joueur && !this.corr && this.contreIA()) {
            const lvl = this.level;
            if (gagne && lvl < 20) {
                const nouveauRoi = roiDuNiveau(lvl + 1) !== roiDuNiveau(lvl) ? ` · ${roiDuNiveau(lvl + 1)}` : '';
                principal = h('button.mt-btn.mt-btn-or', { attrs: { type: 'button' }, on: { click: () => this.rematch(lvl + 1) } }, `Niveau ${lvl + 1}${nouveauRoi}`);
                liens.push(lien('Rejouer', () => this.rematch(lvl)));
            } else {
                principal = h('button.mt-btn.mt-btn-or', { attrs: { type: 'button' }, on: { click: () => this.rematch(lvl) } }, 'Rejouer');
                if (perdu && lvl > 1) liens.push(lien(`Niveau ${lvl - 1}`, () => this.rematch(lvl - 1)));
            }
        } else if (joueur && !this.corr) {
            const adv = this.username === this.wplayer ? this.bplayer : this.wplayer;
            if (this.revanche === 'recue') {
                message = `${adv.split('#')[0]} propose une revanche.`;
                principal = h('button.mt-btn.mt-btn-or', { attrs: { type: 'button' }, on: { click: () => this.rematch() } }, 'Accepter');
                liens.push(lien('Refuser', () => this.rejectRematchOffer()));
            } else if (this.revanche === 'envoyee') {
                message = 'Revanche proposée, en attente de réponse…';
            } else if (this.revanche === 'refusee') {
                message = 'Revanche refusée.';
            } else {
                principal = h('button.mt-btn.mt-btn-or', { attrs: { type: 'button' }, on: { click: () => this.rematch() } }, 'Revanche');
            }
        }
        // Draft : « Rejouer » et « Revanche » gardent les équipes (livret) ; un nouveau tirage au choix
        if (joueur && !this.corr && !this.tournamentGame && this.rois && !this.revancheId && this.revanche !== 'envoyee')
            liens.push(lien('Nouveau Draft', () => this.rematch(undefined, true)));
        if (this.revancheId) liens.unshift(lien('Voir la revanche', () => window.location.assign(this.home + '/' + this.revancheId)));
        if (fin.status !== 0) liens.push(lien('Analyser', () => this.analysis(this.home)));
        // Pas de bouton « Menu » : le logo MATATAK de l'en-tête (revenu à la fin) mène déjà à /jouer

        this.gameControls = patch(this.gameControls, h('div.fin-partie', {
            class: { gagne: joueur && gagne, perdu: joueur && perdu },
            attrs: { role: 'status', 'aria-live': 'polite' },
        }, [
            h('div.fin-titre', titre),
            h('p.fin-raison', this.raisonFin(fin.status, fin.result, joueur && gagne, joueur && perdu)),
            message ? h('p.fin-message', message) : '',
            principal ?? '',
            liens.length ? h('div.fin-liens', liens) : '',
        ]));
    }

    private checkStatus = (msg: MsgBoard | MsgGameEnd) => {
        if (msg.gameId !== this.gameId) return;
        if (msg.status >= 0) {
            this.status = msg.status;
            this.result = msg.result;
            this.clocks[0].pause(false);
            this.clocks[1].pause(false);
            if (this.result !== "*" && !this.spectator && !this.finishedGame)
                sound.gameEndSound(msg.result, this.mycolor);

            if ("rdiffs" in msg) this.gameOver(msg.rdiffs);
            selectMove(this, this.ply);

            updateResult(this);

            if ("ct" in msg && msg.ct) {
                this.ctableContainer = patch(this.ctableContainer, h('div.ctable-container'));
                this.ctableContainer = patch(this.ctableContainer, crosstableView(msg.ct, this.gameId));
            }

            // Cadre de fin sous le plateau (remplace l'ancienne fenêtre posée sur le plateau)
            const vientDeFinir = !this.fin && !this.finishedGame;
            document.body.classList.remove('en-partie');
            this.menuOuvert = false;
            this.renderBarre();
            this.fin = { status: msg.status, result: msg.result };
            // Le panneau d'infos disait encore « En cours »
            const statut = document.querySelector('.info-statut');
            if (statut && vientDeFinir) statut.textContent = msg.status === 0 ? 'Annulée' : 'Terminée';
            this.renderFin();
            if (vientDeFinir) {
                const el = document.querySelector('.fin-partie');
                if (el) setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
            }

            // clean up gating/promotion widget left over the ground while game ended by time out
            const container = document.getElementById('extension_choice') as HTMLElement;
            if (container instanceof Element) patch(container, h('extension'));

            if (this.tv) {
                setInterval(() => { this.doSend({ type: "updateTV", gameId: this.gameId, profileId: this.profileid }); }, 2000);
            }

            this.clearDialog();
        }
    }

    private onMsgUpdateTV = (msg: MsgUpdateTV) => {
        if (msg.gameId !== this.gameId) {
            if (this.profileid !== "") {
                window.location.assign(this.home + '/@/' + this.profileid + '/tv');
            } else {
                window.location.assign(this.home + '/tv');
            }
            // TODO: reuse current websocket to fix https://github.com/gbtami/pychess-variants/issues/142
            // this.doSend({ type: "game_user_connected", username: this.username, gameId: msg.gameId });
        }
    }

    async onMsgBoard(msg: MsgBoard) {
        if (msg.gameId !== this.gameId) return;

        // console.log("got board msg:", msg);
        let latestPly;
        if (this.spectator) {
            // Fix https://github.com/gbtami/pychess-variants/issues/687
            latestPly = (this.ply === -1 || msg.ply === this.ply + 1);
        } else {
            latestPly = (this.ply === -1 || msg.ply >= this.ply + 1); // when receiving a board msg with full list of moves (aka steps) after reconnecting
            // its ply might be ahead with 2 ply - our move that failed to get confirmed
            // because of disconnect and then also opp's reply to it, that we didn't
            // receive while offline. Not sure if it could be ahead with more than 2 ply
        }

        if (msg.takeback) latestPly = true;

        if (latestPly) this.ply = msg.ply;

        if (this.ply === 0) {
            if (this.variant.rules.setup) {
                // force to set new dests after setup phase!
                latestPly = true;
            } else {
                this.expiStart = Date.now();
                setTimeout(this.showExpiration, 350);
            }
        }

        if (this.ply >= 2) {
            const container0 = document.getElementById('berserk0') as HTMLElement;
            if (container0) patch(container0, h('div#berserk0', ''));

            const container1 = document.getElementById('berserk1') as HTMLElement;
            if (container1) patch(container1, h('div#berserk1', ''));

            if (!this.spectator && this.corr) {
                const drawEl = document.getElementById("draw") as HTMLInputElement;
                if (drawEl) drawEl.disabled = false;
                const resignEl = document.getElementById("resign") as HTMLInputElement;
                if (resignEl) resignEl.disabled = false;
            }
        }

        if (this.ply === 1 || this.ply === 2) {
            this.expiStart = 0;
            this.renderExpiration();
            if (this.ply === 1) {
                this.expiStart = Date.now();
                setTimeout(this.showExpiration, 350);
            }
        }

        // turnColor have to be actualized before setDests() !!!
        const parts = msg.fen.split(" ");
        this.turnColor = parts[1] === "w" ? "white" : "black";
        this.fullfen = msg.fen;
        this.clocktimes = msg.clocks || this.clocktimes;

        this.result = msg.result;
        this.status = msg.status;
        this.draftPhase = msg.phase;
        if (msg.rois && !this.rois) {
            this.rois = msg.rois;
            this.appliquerLesRois();
        }

        if (msg.steps.length > 1) {
            this.steps = [];
            const container = document.getElementById('movelist') as HTMLElement;
            patch(container, h('div#movelist'));

            msg.steps.forEach((step) => {
                this.steps.push(step);
            });
            const full = true;
            const activate = true;
            const result = false;
            updateMovelist(this, full, activate, result);
        } else {
            if (msg.ply === this.steps.length) {
                const step = {
                    'fen': msg.fen,
                    'move': msg.lastMove,
                    'check': msg.check,
                    'turnColor': this.turnColor,
                    'san': msg.steps[0].san,
                };
                this.steps.push(step);
                const full = false;
                const activate = !this.spectator || latestPly;
                const result = false;
                updateMovelist(this, full, activate, result);
            }
        }

        // if (this.variant.rules.setup && this.ply === 0 && this.status === -1) { // status STARTED
        //     this.initialFen = msg.fen;
        // }

        this.clockOn = (Number(msg.ply) >= 2);
        this.renderBarre();
        if ((!this.spectator && this.clockOn) || this.tournamentGame) {
            const container = document.getElementById('abort') as HTMLElement;
            if (container) {
                // No takeback for Duck chess, because it already has undo for first leg of moves
                if ((this.wtitle === 'BOT' || this.btitle === 'BOT') && !this.variant.rules.duck) {
                    patch(container, h('button#takeback', { on: { click: () => this.takeback() }, props: { title: _('Propose takeback') } }, [h('i', { class: { "icon": true, "icon-reply": true } }),]));
                } else {
                    patch(container, h('div'));
                }
            }
        } else if (!this.spectator && !this.clockOn) {
            const container = document.getElementById('takeback') as HTMLElement;
            if (container) {
                patch(container, this.buttonAbort());
            }
        }

        const lastMove = uci2LastMove(msg.lastMove);
        const step = this.steps[this.steps.length - 1];
        let capture = false;
        if (lastMove) {
            //const piece = this.chessground.state.boardState.pieces.get(lastMove[1] as cg.Key);
            //capture = (piece !== undefined && piece.role !== '_-piece' && step.san?.slice(0, 2) !== 'O-') || (step.san?.slice(1, 2) === 'x');
            capture = this.ffishBoard.isCapture(msg.lastMove);
        }
        if (msg.steps.length <= 2 && this.steps.length > 1 && (this.turnColor === this.mycolor || this.spectator)) {
            if (!this.finishedGame) sound.moveSound(this.variant, capture);
        }
        // promotion (coup terminé par la pièce choisie, ex. a7a8d) : son en plus du coup, pour les deux joueurs
        if (msg.steps.length <= 2 && this.steps.length > 1 && !this.finishedGame && /^[a-z]\d+[a-z]\d+[a-z]$/.test(msg.lastMove ?? '')) {
            sound.promotion();
        }
        this.checkStatus(msg);
        if (msg.steps.length === 1 && !this.spectator && msg.check && !this.finishedGame) {
            sound.check();
        }

        if (this.variant.ui.counting) {
            this.updateCount(msg.fen);
        }

        if (this.variant.ui.materialPoint) {
            [this.vmiscInfoW, this.vmiscInfoB] = updatePoint(this.variant, msg.fen, this.vmiscInfoW, this.vmiscInfoB);
        }

        const oppclock = !this.flipped() ? 0 : 1;
        const myclock = 1 - oppclock;

        this.clocks[0].pause(false);
        this.clocks[1].pause(false);
        if (this.byoyomi && msg.byo) {
            this.clocks[oppclock].byoyomiPeriod = msg.byo[(this.oppcolor === 'white') ? WHITE : BLACK];
            this.clocks[myclock].byoyomiPeriod = msg.byo[(this.mycolor === 'white') ? WHITE : BLACK];
        }

        this.clocks[oppclock].setTime(this.clocktimes[(this.oppcolor === 'white') ? WHITE : BLACK]);
        this.clocks[myclock].setTime(this.clocktimes[(this.mycolor === 'white') ? WHITE : BLACK]);

        let bclock;
        if (!this.flipped()) {
            bclock = this.mycolor === "black" ? 1 : 0;
        } else {
            bclock = this.mycolor === "black" ? 0 : 1;
        }
        const wclock = 1 - bclock
        if (this.berserked['wberserk'] || msg.berserk.w) {
            this.clocks[wclock].increment = 0;
            if (msg.ply <= 2) this.clocks[wclock].setTime(this.base * 1000 * 30);
        }
        if (this.berserked['bberserk'] || msg.berserk.b) {
            this.clocks[bclock].increment = 0;
            if (msg.ply <= 2) this.clocks[bclock].setTime(this.base * 1000 * 30);
        }
        // console.log("onMsgBoard() this.clockOn && msg.status", this.clockOn, msg.status);
        if (this.spectator) {
            if (latestPly) {
                this.chessground.set({
                    fen: (this.fog) ? fogFen(this.fullfen) : this.fullfen,
                    turnColor: this.turnColor,
                    check: msg.check,
                    lastMove: (this.fog) ? undefined : lastMove,
                    movable: { color: undefined },
                });
            }
            if (this.clockOn && !this.unlimited && msg.status < 0) {
                if (this.turnColor === this.mycolor) {
                    this.clocks[myclock].start();
                } else {
                    this.clocks[oppclock].start();
                }
            }
            // This is needed for above capture detection
            if (this.ffishBoard) {
                this.ffishBoard.setFen(this.fullfen);
            }
        } else {
            if (this.turnColor === this.mycolor) {
                if (latestPly) {
                    this.chessground.set({
                        fen: (this.fog) ? fogFen(this.fullfen) : this.fullfen,
                        turnColor: this.turnColor,
                        movable: {
                            free: false,
                            color: (this.variant.rules.setup && this.status === -2) ? undefined : this.mycolor,
                        },
                        check: msg.check,
                        lastMove: (this.fog) ? undefined : lastMove,
                    });

                    // This have to be exactly here (and before this.performPremove as well!!!),
                    // because in case of takeback 
                    // ataxx setDests() needs not just actualized turnColor but
                    // actualized chessground.state.boardState.pieces as well !!!
                    if (this.ffishBoard) {
                        this.ffishBoard.setFen(this.fullfen);
                        this.setDests();
                    }

                    if (!this.focus) {
                        const sanMove = (this.fog) ? 'a move' : step.san;
                        this.notifyMsg(`Played ${sanMove}\nYour turn.`);
                    }

                    // prevent sending premove/predrop when (auto)reconnecting websocked asks server to (re)sends the same board to us
                    // console.log("trying to play premove....");
                    // TODO Handle premove with Local Ai moves
                    // if (this.premove) this.performPremove();
                }
                if (this.clockOn && !this.unlimited && msg.status < 0) {
                    this.clocks[myclock].start();
                    // console.log('MY CLOCK STARTED');
                }
            } else {
                this.chessground.set({
                    // giving fen here will place castling rooks to their destination in chess960 variants
                    fen: (this.fog) ? fogFen(this.fullfen) : parts[0],
                    turnColor: this.turnColor,
                    check: msg.check,
                    lastMove: lastMove,
                });

                // This have to be here, because in case of takeback 
                // ataxx setDests() needs not just actualized turnColor but
                // actualized chessground.state.boardState.pieces as well !!!
                if (this.ffishBoard) {
                    this.ffishBoard.setFen(this.fullfen);
                    this.setDests();
                }

                if (this.clockOn && !this.unlimited && msg.status < 0) {
                    this.clocks[oppclock].start();
                    // console.log('OPP CLOCK  STARTED');
                }

                this.searchBestMove();

                // const isOpponentAI = true; // this.players.some(p => p.startsWith('Local-AI-'));
                // if (isOpponentAI && this.status < 0) {
                //     const legalMoves = this.ffishBoard.legalMoves().split(' ').filter(o => o);
                //     if (legalMoves.length > 0) {
                //         const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
                //         this.doSendMove(randomMove);
                //     }

                // }              
            }
        }

        if (this.variant.ui.showCheckCounters) {
            this.updateCheckCounters(msg.fen);
        }

        if (this.variant.material.showDiff) {
            this.updateMaterial();
        }

        this.updatePocketsVisibility(this.draftPhase);
    }

    goPly(ply: number, plyVari = 0) {
        // console.log("roundCtrl.goPly()");
        super.goPly(ply, plyVari);

        if (this.spectator || this.status >= 0 || ply !== this.steps.length - 1) {
            this.chessground.set({ movable: { color: undefined } });
        } else if (ply === this.steps.length - 1) {
            this.chessground.set({ movable: { color: this.mycolor } });
        }

        if (this.variant.material.showDiff) {
            this.updateMaterial();
        }
    }

    // Cadence 0+0 (hors correspondance) : partie sans limite de temps, pendules masquées et arrêtées.
    get unlimited(): boolean {
        return this.base === 0 && this.inc === 0 && !this.corr && this.byoyomiPeriod === 0;
    }

    doSendMove(move: string) {
        const send = (move: string) => {
            this.clearDialog();
            let clock_times: Clocks, increment;
            const oppclock = !this.flipped() ? 0 : 1
            const myclock = 1 - oppclock;
            const activeclock = (this.turnColor === this.mycolor) ? myclock : oppclock;
            const inactiveclock = 1 - activeclock;

            if (!this.corr) {
                // pause() will add increment!
                this.clocks[activeclock].pause((this.base === 0 && this.ply < 2) ? false : true);

                let bclock;
                if (!this.flipped()) {
                    bclock = this.mycolor === "black" ? 1 : 0;
                } else {
                    bclock = this.mycolor === "black" ? 0 : 1;
                }
                const wclock = 1 - bclock

                if (!this.berserked[(this.turnColor === "white") ? "wberserk" : "bberserk"]) {
                    increment = (this.inc > 0 && this.ply >= 2 && !this.byoyomi) ? this.inc * 1000 : 0;
                } else {
                    increment = 0;
                }

                const bclocktime = (this.turnColor === "black" && this.preaction) ? this.clocktimes[BLACK] + increment : this.clocks[bclock].duration;
                const wclocktime = (this.turnColor === "white" && this.preaction) ? this.clocktimes[WHITE] + increment : this.clocks[wclock].duration;

                clock_times = [wclocktime, bclocktime];
            } else {
                clock_times = [0, 0];
                increment = 0;
            }

            this.lastMaybeSentMsgMove = { type: "move", gameId: this.gameId, move: move, clocks: clock_times, ply: this.ply + 1 };
            this.doSend(this.lastMaybeSentMsgMove as JSONObject);

            if (this.preaction && this.turnColor === this.mycolor) {
                this.clocks[myclock].setTime(this.clocktimes[(this.mycolor === 'white') ? WHITE : BLACK] + increment);
            }

            // Prevent sending "flag" message by opp clock via flagCallback
            // fixes https://github.com/gbtami/pychess-variants/issues/1588
            this.turnColor = this.turnColor === "white" ? "black" : "white";

            if (this.clockOn && !this.unlimited) this.clocks[inactiveclock].start();
        }

        const confirmCorrMove = localStorage.confirmCorrMove === undefined ? true : localStorage.getItem("confirmCorrMove") === "true";
        if (confirmCorrMove && this.corr) {
            this.renderConfirmCorrMove(send, move);
        } else {
            send(move);
        }
    }

    private startCount = () => {
        this.doSend({ type: "count", gameId: this.gameId, mode: "start" });
    }

    private stopCount = () => {
        this.doSend({ type: "count", gameId: this.gameId, mode: "stop" });
    }

    private updateCount = (fen: cg.FEN) => {
        [this.vmiscInfoW, this.vmiscInfoB] = updateCount(fen, this.vmiscInfoW, this.vmiscInfoB);
        const countButton = document.getElementById('count') as HTMLElement;
        if (countButton) {
            const [, , countingSide, countingType] = getCounting(fen);
            const myturn = this.mycolor === this.turnColor;
            if (countingType === 'board')
                if (countingSide === this.mycolor[0])
                    patch(countButton, h('button#count', { on: { click: () => this.stopCount() }, props: { title: _('Stop counting') }, class: { disabled: !myturn } }, _('Stop')));
                else
                    patch(countButton, h('button#count', { on: { click: () => this.startCount() }, props: { title: _('Start counting') }, class: { disabled: !(myturn && countingSide === '') } }, _('Count')));
            else
                patch(countButton, h('button#count', { props: { title: _('Start counting') }, class: { disabled: true } }, _('Count')));
        }
    }

    private updateMaterial(): void {
        if (this.variant.material.showDiff && this.materialDifference)
            [this.vmaterial0, this.vmaterial1] = updateMaterial(this.variant, this.fullfen, this.vmaterial0, this.vmaterial1, this.flipped(), this.mycolor);
        else
            [this.vmaterial0, this.vmaterial1] = emptyMaterial(this.variant, this.vmaterial0, this.vmaterial1);
    }

    private setPremove = (orig: cg.Orig, dest: cg.Key, metadata?: cg.SetPremoveMetadata) => {
        this.premove = { orig, dest, metadata };
        // console.log("setPremove() to:", orig, dest, meta);
    }

    private unsetPremove = () => {
        this.premove = undefined;
        this.preaction = false;
    }

    private performPremove = () => {
        // const { orig, dest, meta } = this.premove;
        // TODO: promotion?
        // console.log("performPremove()", orig, dest, meta);
        this.chessground.playPremove();
    }

    private renderExpiration = () => {
        // We return sooner in case the client belongs to a spectator or the 
        // game is non tournament game.
        if (this.spectator || !this.tournamentGame) return;
        let position = (this.turnColor === this.mycolor) ? "bottom" : "top";
        if (this.flipped()) position = (position === "top") ? "bottom" : "top";
        let expi = (position === 'top') ? 0 : 1;
        const timeLeft = Math.max(0, this.expiStart - Date.now() + this.firstmovetime);
        // console.log("renderExpiration()", position, timeLeft);
        if (timeLeft === 0 || this.status >= 0) {
            this.expirations[0] = patch(this.expirations[0], h('div#expiration-top'));
            this.expirations[1] = patch(this.expirations[1], h('div#expiration-bottom'));
        } else {
            const emerg = (this.turnColor === this.mycolor && timeLeft < 8000);
            if (!rang && emerg) {
                sound.lowTime();
                rang = true;
            }
            const secs: number = Math.floor(timeLeft / 1000);
            if (!isNaN(secs)) {
                this.expirations[expi] = patch(this.expirations[expi], h('div#expiration-' + position + '.expiration',
                    {
                        class:
                            { emerg, 'bar-glider': this.turnColor === this.mycolor }
                    },
                    [ngettext('%1 second to play the first move', '%1 seconds to play the first move', secs)]
                ));
            }
        }
    }

    private showExpiration = () => {
        if (this.expiStart === 0 || this.spectator) return;
        this.renderExpiration();
        setTimeout(this.showExpiration, 250);
    }

    private onMsgUserConnected = (msg: MsgUserConnected) => {
        this.username = msg["username"];
        if (this.spectator) {
            this.doSend({ type: "is_user_present", username: this.wplayer, gameId: this.gameId });
            this.doSend({ type: "is_user_present", username: this.bplayer, gameId: this.gameId });

        } else {
            this.firstmovetime = msg.firstmovetime || this.firstmovetime;

            const opp_name = this.username === this.wplayer ? this.bplayer : this.wplayer;
            this.doSend({ type: "is_user_present", username: opp_name, gameId: this.gameId });

            const container = document.getElementById('player1') as HTMLElement;
            patch(container, h('i-side#player1.online', { class: { "icon": true, "icon-online": true, "icon-offline": false } }));

            // prevent sending gameStart message when user just reconnecting
            if (msg.ply === 0) {
                this.doSend({ type: "ready", gameId: this.gameId });
                //    if (this.variant.setup) {
                //        this.doSend({ type: "board", gameId: this.gameId });
                //    }
            }
        }
        // We always need this to get possible moves made while our websocket connection was established
        // fixes https://github.com/gbtami/pychess-variants/issues/962
        this.doSend({ type: "board", gameId: this.gameId });
    }

    private onMsgUserPresent = (msg: MsgUserPresent) => {
        // console.log(msg);
        if (msg.username === this.players[0]) {
            const container = document.getElementById('player0') as HTMLElement;
            patch(container, h('i-side#player0.online', { class: { "icon": true, "icon-online": true, "icon-offline": false } }));
        } else {
            const container = document.getElementById('player1') as HTMLElement;
            patch(container, h('i-side#player1.online', { class: { "icon": true, "icon-online": true, "icon-offline": false } }));
        }
    }

    private onMsgUserDisconnected = (msg: MsgUserDisconnected) => {
        // console.log(msg);
        if (['BOT', 'LIA'].includes(this.titles[this.players.indexOf(msg.username)])) return;

        if (msg.username === this.players[0]) {
            const container = document.getElementById('player0') as HTMLElement;
            patch(container, h('i-side#player0.online', { class: { "icon": true, "icon-online": false, "icon-offline": true } }));
        } else {
            const container = document.getElementById('player1') as HTMLElement;
            patch(container, h('i-side#player1.online', { class: { "icon": true, "icon-online": false, "icon-offline": true } }));
        }
    }

    private onMsgMoreTime = (msg: MsgMoreTime) => {
        chatMessage('', msg.username + _(' +15 seconds'), "roundchat");
        if (this.spectator) {
            if (msg.username === this.players[0]) {
                this.clocks[0].setTime(this.clocks[0].duration + 15 * 1000);
            } else {
                this.clocks[1].setTime(this.clocks[1].duration + 15 * 1000);
            }
        } else {
            this.clocks[1].setTime(this.clocks[1].duration + 15 * 1000);
        }
    }

    private onMsgDrawOffer = (msg: MsgDrawOffer) => {
        chatMessage("", msg.message, "roundchat");
        if (!this.spectator && msg.username !== this.username) this.renderDrawOffer();
    }

    private onMsgDrawRejected = (msg: MsgDrawRejected) => {
        chatMessage("", msg.message, "roundchat");
        this.clearDialog();
    }

    private onMsgRematchOffer = (msg: MsgRematchOffer) => {
        chatMessage("", msg.message, "roundchat");
        if (!this.spectator && msg.username !== this.username) this.renderRematchOffer();
    }

    private onMsgRematchRejected = (msg: MsgRematchRejected) => {
        chatMessage("", msg.message, "roundchat");
        if (this.revanche === 'envoyee') {
            this.revanche = 'refusee';
            this.renderFin();
        }
    }

    private onMsgCount = (msg: MsgCount) => {
        chatMessage("", msg.message, "roundchat");
        if (msg.message.endsWith("started")) {
            if (this.turnColor === 'white')
                this.vmiscInfoW = patch(this.vmiscInfoW, h('div#misc-infow', '0/64'));
            else
                this.vmiscInfoB = patch(this.vmiscInfoB, h('div#misc-infob', '0/64'));
        }
        else if (msg.message.endsWith("stopped")) {
            if (this.turnColor === 'white')
                this.vmiscInfoW = patch(this.vmiscInfoW, h('div#misc-infow', ''));
            else
                this.vmiscInfoB = patch(this.vmiscInfoB, h('div#misc-infob', ''));
        }
    }

    connectFsf() {
        window.onFSFline = this.onFSFline;
        if (window.fsf && !this.isEngineReady) {
            // Ne rien faire ici. On attend que le moteur envoie sa ligne de version (dans onFSFline).
        } else {
            // Le script stockfish.js n'est peut-être pas encore chargé
            setTimeout(() => this.connectFsf(), 250);
        }
    }

    private isReady(): Promise<void> {
        return new Promise(resolve => {
            this.readyokCallback = () => {
                this.readyokCallback = null; // Le callback est à usage unique
                resolve();
            };
            this.fsfPostMessage('isready');
        });
    }

    private async searchBestMove(): Promise<void> {
        if (this.enDraft || this.isSearching || this.status >= 0 || !this.uciOk || !this.isEngineReady || this.turnColor === this.mycolor || (this.wtitle != 'LIA' && this.btitle != 'LIA')) {
            return;
        }
        this.isSearching = true;
        this.reflexion = { debut: performance.now(), vise: this.tempsVise() };
        this.marquerReflexion(true);
        await this.isReady();

        this.fsfPostMessage('setoption name UCI_Variant value ' + this.variant.name);
        //this.fsfPostMessage('setoption name UCI_Chess960 value ' + this.chess960);
        // this.fsfPostMessage('setoption name UCI_LimitStrength value true');
        this.fsfPostMessage('setoption name Skill Level value ' + LVL_SKILL[this.level - 1]);
        //this.fsfPostMessage('setoption name UCI_AnalyseMode value false');

        this.fsfPostMessage('ucinewgame');
        await this.isReady();

        // Définir la position en utilisant le FEN initial et la liste des coups
        // Remove premove ? .slice(0, this.premove ? -1 : undefined)
        const moves = this.steps.slice(1).map(s => s.move).filter(m => m).join(' ');
        console.log("MOVES :", moves);
        this.fsfPostMessage(`position fen ${this.initialFen} moves ${moves}`);

        // Lancer la recherche avec les temps d'horloge actuels
        //const [wtime, btime] = this.clocktimes;
        //this.fsfPostMessage(`go wtime ${wtime} btime ${btime} winc ${this.inc * 1000} binc ${this.inc * 1000}`);

        // Les niveaux 1 à 15 s'arrêtent à la profondeur 5 en quelques millisecondes ; les plus forts
        // calculent pendant le temps visé (au moins 1 s, sauf quand la pendule presse).
        const movetime = Math.max(this.reflexion.vise, this.reflexion.vise === 0 ? 200 : 1000);
        this.fsfPostMessage(`go depth ${LVL_DEPTHS[this.level - 1]} movetime ${Math.round(movetime)}`);

        this.isSearching = false;
    }

    private reflexion = { debut: 0, vise: 0 };

    /** Temps de réflexion visé pour le prochain coup de l'ordinateur, en ms. */
    private tempsVise(): number {
        const coups = this.ffishBoard ? this.ffishBoard.legalMoves().split(' ').filter(c => c).length : 20;
        if (coups <= 1) return 400; // coup forcé
        // Un Roi plus fort réfléchit un peu plus ; une position riche aussi ; un peu de hasard
        let vise = (600 + this.level * 80 + Math.sqrt(coups) * 170) * (0.6 + Math.random() * 0.8);
        const fort = this.level >= 16;
        if (fort) vise += (this.level - 15) * 700 * (0.8 + Math.random() * 0.4);
        if (this.ply < 4) vise *= 0.5; // début de partie : coups naturels, vite joués
        vise = Math.min(vise, fort ? REFLEXION_MAX_FORT : REFLEXION_MAX);
        if (!this.unlimited) {
            const reste = this.clocktimes[this.oppcolor === 'white' ? WHITE : BLACK];
            if (reste < RESERVE_PRESSE) return 0;
            vise = Math.min(vise, reste / 40 + this.inc * 1000 * 0.5);
        }
        return vise;
    }

    /** Joue le coup trouvé quand le temps visé est écoulé, si la partie n'a pas bougé entre-temps. */
    private jouerCoupOrdinateur(coup: string) {
        const ply = this.ply;
        const attente = Math.max(0, this.reflexion.vise - (performance.now() - this.reflexion.debut));
        setTimeout(() => {
            this.marquerReflexion(false);
            if (this.status >= 0 || this.ply !== ply || this.turnColor === this.mycolor) return;
            this.doSendMove(coup);
        }, attente);
    }

    /** Trois losanges qui pulsent à côté du nom de l'ordinateur pendant qu'il réfléchit. */
    private marquerReflexion(oui: boolean) {
        const enHaut = !this.flipped();
        document.body.classList.toggle('ordi-reflechit-haut', oui && enHaut);
        document.body.classList.toggle('ordi-reflechit-bas', oui && !enHaut);
    }

    fsfPostMessage(msg: string) {
        if (window.fsf === undefined) {
            // At very first time we may have to wait for fsf module to initialize
            setTimeout(this.fsfPostMessage.bind(this), 100, msg);
        } else {
            if (this.fsfDebug) console.debug('<---', msg);
            window.fsf.postMessage(msg);
        }
    }

    protected onMessage(evt: MessageEvent) {
        // console.log("<+++ onMessage():", evt.data);
        super.onMessage(evt);

        if (evt.data === '/n') return;
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
            case "board":
                this.onMsgBoard(msg);
                break;
            case "gameEnd":
                this.checkStatus(msg);
                break;
            case "gameStart":
                this.onMsgGameStart(msg);
                break;
            case "game_user_connected":
                this.onMsgUserConnected(msg);
                break;
            case "user_present":
                this.onMsgUserPresent(msg);
                break;
            case "user_disconnected":
                this.onMsgUserDisconnected(msg);
                break;
            case "new_game":
                this.onMsgNewGame(msg);
                break;
            case "view_rematch":
                this.onMsgViewRematch(msg);
                break;
            case "draw_offer":
                this.onMsgDrawOffer(msg);
                break;
            case "draw_rejected":
                this.onMsgDrawRejected(msg);
                break;
            case "rematch_offer":
                this.onMsgRematchOffer(msg);
                break;
            case "rematch_rejected":
                this.onMsgRematchRejected(msg);
                break;
            case "moretime":
                this.onMsgMoreTime(msg);
                break;
            case "updateTV":
                this.onMsgUpdateTV(msg);
                break
            case "setup":
                this.onMsgSetup(msg);
                break;
            case "count":
                this.onMsgCount(msg);
                break;
            case "berserk":
                this.onMsgBerserk(msg);
                break;
            case "draft":
                this.onMsgDraft(msg);
                break;
        }
    }
}
