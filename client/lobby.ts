import { carteTournante, duoEchange } from './carteAnimee';
import { ROIS, roiDuNiveau, saisonDuNiveau, Saison } from './rois';
import { WebsocketHeartbeatJs } from './socket/socket';
import { installeur, ouvrirInstallation } from './installer';
import { equipeMemorisee, fenPourCouleur } from './equipe';
import { sound } from './sound';
import { chargerPalmares, couronne, PalmaresInfos, rangTexte } from './palmares';

import { h, VNode } from 'snabbdom';

import { Api } from "chessgroundx/api";
import { Chessground } from 'chessgroundx';

import { JSONObject } from './types';
import { _, ngettext, languageSettings } from './i18n';
import { patch } from './document';
import { boardSettings } from './boardSettings';
import { chatMessage, chatView, ChatController } from './chat';
import { contestVariants, enabledVariants, twoBoarsVariants, VARIANTS, selectVariant, Variant } from './variants';
import { timeControlStr, changeTabs, setAriaTabClick, displayName } from './view';
import { notify } from './notification';
import { PyChessModel } from "./types";
import { MsgBoard, MsgChat, MsgFullChat } from "./messages";
import { variantPanels } from './lobby/layer1';
import { Post, Stream, Spotlight, MsgInviteCreated, MsgHostCreated, MsgGetSeeks, MsgNewGame, MsgGameInProgress, MsgUserConnected, MsgPing, MsgError, MsgShutdown, MsgCounter, MsgStreams, MsgSpotlights, Seek, CreateMode, TvGame, TcMode } from './lobbyType';
import { validFen, uci2LastMove } from './chess';
import { seekViewBughouse, switchEnablingLobbyControls } from "./bug/lobby.bug";
import { handleOngoingGameEvents, Game, gameViewPlaying, compareGames } from './nowPlaying';
import { createWebsocket } from "@/socket/webSocketUtils";


const autoPairingTCs: [number, number, number][] = [
    [1, 0, 0],
    [3, 0, 0],
    [3, 2, 0],
    [5, 5, 0],
    [15, 10, 0],
    [2, 15, 1],
    [10, 30, 1],
];

export function createModeStr(mode: CreateMode) {
    switch (mode) {
        case 'playAI': return _("Play");
        case 'playBOT': return _("Play with a BOT");
        case 'playFriend': return _("Challenge Friend");
        case 'createHost': return _("Host a game for others");
        case 'createGame': return _("Create a game");
        default:
            return '';
    }
}

// ----- Page /jouer : choix mémorisés sur l'appareil -----
type JouerAdversaire = 'ia' | 'ami' | 'classee';
interface JouerChoix {
    adv: JouerAdversaire;
    variant: 'matatak' | 'matatakmini';
    level: number;
    tc: string;
    color: 'w' | 'r' | 'b';
    equipe: 'nouvelle' | 'garder';
}
interface Cadence { id: string; label: string; detail: string; min: number; inc: number; }

const CADENCES_IA: Cadence[] = [
    { id: '0+0', label: 'Sans limite', detail: '', min: 0, inc: 0 },
    { id: '3+2', label: '3 min', detail: '+2', min: 3, inc: 2 },
    { id: '5+3', label: '5 min', detail: '+3', min: 5, inc: 3 },
    { id: '10+5', label: '10 min', detail: '+5', min: 10, inc: 5 },
];
const CADENCES_AMI: Cadence[] = [
    { id: '3+2', label: '3 min', detail: '+2', min: 3, inc: 2 },
    { id: '5+3', label: '5 min', detail: '+3', min: 5, inc: 3 },
    { id: '10+5', label: '10 min', detail: '+5', min: 10, inc: 5 },
    { id: '15+10', label: '15 min', detail: '+10', min: 15, inc: 10 },
];
const IMG_VITRINE = '/static/images/background/vitrine/';
const IMG_ROI: Record<Saison, string> = { ete: '01-azar.webp', automne: '02-shans.webp', hiver: '03-karma.webp', printemps: '04-mojo.webp' };

// Onglet « Classée » : réponse de GET /api/classee (server/classee.py)
interface ClasseeVariante { r: number; prov: boolean; nb: number; cadence: string; }
interface JoueurEnLigne { u: string; en_partie: boolean; matatak: ClasseeVariante; matatakmini: ClasseeVariante; }
interface ClasseeInfos { connecte: boolean; matatak?: ClasseeVariante; matatakmini?: ClasseeVariante; en_ligne?: JoueurEnLigne[]; }
// Défi reçu d'un joueur en ligne (server/classee.py defier)
interface DefiRecu { id: string; de: string; r: number; prov: boolean; variant: 'matatak' | 'matatakmini'; cadence: string; }

const NOM_PLATEAU = { matatak: 'Matatak', matatakmini: 'Matatak Mini' };
// Pourquoi un défi envoyé n'a pas abouti (message classee_defi_fin)
const FIN_DEFI: Record<string, (nom: string) => string> = {
    refuse: nom => `${nom} a refusé le défi.`,
    expire: nom => `Pas de réponse de ${nom}.`,
    absent: nom => nom ? `${nom} n'est plus disponible.` : "Ce joueur n'est plus disponible.",
};

function texteClassement(v?: ClasseeVariante): string {
    return v ? `${v.r}${v.prov ? ' ?' : ''}` : '…';
}

function lireStockage(cle: string): string | null {
    try { return localStorage.getItem(cle); } catch { return null; }
}

// Onboarding : « fini » (tutoriel terminé, tutorialCtrl.ts) ou « connu » (le joueur a dit connaître les règles)
function reglesConnues(): boolean {
    const v = lireStockage('matatak_tutoriel');
    return v === 'fini' || v === 'connu';
}
function noterReglesConnues() {
    try { localStorage.setItem('matatak_tutoriel', 'connu'); } catch { /* navigation privée */ }
}
function etapeTutoriel(): number {
    return Math.min(7, Number(lireStockage('matatak_tutoriel_etape')) || 0);
}

// Bandeau « Installer l'appli » sous le panneau de /jouer : seulement si l'installation est possible sur cet
// appareil, hors de l'appli installée, après une première partie terminée (roundCtrl.ts note
// « matatak_partie_finie ») pour ne pas concurrencer le bouton doré d'un nouveau joueur, et plus
// jamais une fois fermé.
function bandeauInstallation(maj: () => void): VNode | null {
    const i = installeur();
    if (!i || i.installee() || !lireStockage('matatak_partie_finie') || lireStockage('matatak_installer') === 'ferme') return null;
    const { appareil } = i.plateforme();
    // Sur ordinateur, seuls Chrome et Edge installent (invitation native) ; sur téléphone, il y a
    // toujours un geste à expliquer (Partager › Sur l'écran d'accueil, menu ⋮…).
    if (!i.peutInviter() && appareil === 'ordinateur') return null;
    const installer = async () => {
        if (i.peutInviter()) {
            if (await i.inviter() === 'indisponible') ouvrirInstallation();
        } else ouvrirInstallation();
        maj();
    };
    const fermer = () => {
        try { localStorage.setItem('matatak_installer', 'ferme'); } catch { /* navigation privée */ }
        maj();
    };
    return h('div.bandeau-installer', { attrs: { role: 'region', 'aria-label': "Installer l'appli" } }, [
        h('button.installer', { attrs: { type: 'button' }, on: { click: installer } }, [
            h('span.icone', { attrs: { 'aria-hidden': 'true' } }, [
                h('svg', { attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } }, [
                    h('path', { attrs: { d: 'M12 3v12M7 10l5 5 5-5M5 20h14' } }),
                ]),
            ]),
            h('span.txt', [h('b', "Installer l'appli"), h('small', "En plein écran, depuis l'écran d'accueil")]),
        ]),
        h('button.fermer', { attrs: { type: 'button', 'aria-label': 'Ne plus proposer' }, on: { click: fermer } }, '×'),
    ]);
}

/** Ce que fait le cran choisi (règle du livret, crans cumulés). Positif : vous ; négatif : votre ami. */
function texteCoupDePouce(n: number): string {
    if (n === 0) return 'Les deux équipes sont de même force. Le Coup de pouce équilibre une partie entre joueurs de niveaux différents.';
    const etapes = n > 0
        ? ['votre Champion gagne une étoile', 'vos Pions aussi', 'les Pions de votre ami en perdent une', 'et son Champion aussi']
        : ['le Champion de votre ami gagne une étoile', 'ses Pions aussi', 'vos Pions en perdent une', 'et votre Champion aussi'];
    const texte = etapes.slice(0, Math.abs(n)).join(', ');
    return texte.charAt(0).toUpperCase() + texte.slice(1) + '.';
}

function lireJouerChoix(): JouerChoix {
    const choix: JouerChoix = { adv: 'ia', variant: 'matatakmini', level: 3, tc: '0+0', color: 'r', equipe: 'nouvelle' };
    try {
        Object.assign(choix, JSON.parse(lireStockage('jouer_choix') ?? '{}'));
    } catch { /* choix par défaut */ }
    if (!['ia', 'ami', 'classee'].includes(choix.adv)) choix.adv = 'ia';
    if (!['matatak', 'matatakmini'].includes(choix.variant)) choix.variant = 'matatakmini';
    if (!['w', 'r', 'b'].includes(choix.color)) choix.color = 'r';
    choix.equipe = 'nouvelle'; // option retirée du menu : un ancien choix « garder » ne s'applique plus
    choix.level = Math.min(20, Math.max(1, Number(choix.level) || 3));
    return choix;
}

function ecrireJouerChoix(choix: JouerChoix) {
    try { localStorage.setItem('jouer_choix', JSON.stringify(choix)); } catch { /* navigation privée */ }
}

// Vignette du vrai plateau (images réduites dans static/images/background/collection/plateaux/)
function damier(taille: 8 | 4) {
    return h(`img.damier.d${taille}`, { attrs: { src: `/static/images/background/collection/plateaux/matatak${taille}x8-112.webp`, alt: '', 'aria-hidden': 'true' } });
}

export class LobbyController implements ChatController {
    sock: WebsocketHeartbeatJs;
    home: string;
    assetURL: string;
    // player;
    // logged_in;
    username: string;
    profileid: string;
    anon: boolean;
    title: string;
    tournamentDirector: boolean;
    fen: string;
    createMode: CreateMode;
    tcMode: TcMode;
    validGameData: boolean;
    selectedColor: 'w' | 'b' | 'r';
    selectedBoost: number;
    readyState: number;
    seeks: Seek[];
    streams: VNode | HTMLElement;
    spotlights: VNode | HTMLElement;
    dialogHeaderEl: VNode | HTMLElement;
    autoPairingActions: VNode | HTMLElement | null;
    tvGame: TvGame;
    tvGameId: string;
    tvGameChessground: Api;
    minutesValues = [
        0, 1 / 4, 1 / 2, 3 / 4, 1, 3 / 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        17, 18, 19, 20, 25, 30, 35, 40, 45, 60, 75, 90
    ];
    incrementValues = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        25, 30, 35, 40, 45, 60, 90
    ];
    minutesStrings = ["0", "¼", "½", "¾"];
    daysValues = [1, 2, 3, 5, 7, 10, 14];
    // Messages envoyés avant l'ouverture de la WebSocket : envoyés dès qu'elle s'ouvre.
    pendingMessages: string[] = [];
    // Page /jouer
    jouerEl: VNode | HTMLElement | null = null;
    jouer: JouerChoix = lireJouerChoix();
    jouerEnvoi = false;
    jouerModel: PyChessModel | null = null;
    // « Plus d'options » de /jouer : non mémorisées, pour ne pas garder un Draft ou une FEN par surprise
    jouerOptions = false;
    jouerDraft = false;
    jouerBoost = 0;
    jouerFen = '';
    // Onglet « Classée » : classements du joueur, recherche d'un adversaire en cours (début, minuteur)
    classee: ClasseeInfos | null = null;
    classeeDebut = 0;
    classeeMinuteur = 0;
    // Joueurs en ligne : liste rafraîchie toutes les 10 s pendant que l'onglet est ouvert ; défis
    classeeRafraichi = 0; // minuteur
    defiEnvoye: { id: string, a: string } | null = null;
    defisRecus: DefiRecu[] = [];
    defiMessage = '';
    palmares: PalmaresInfos | null = null;

    constructor(el: HTMLElement, model: PyChessModel) {
        console.log("LobbyController constructor", el, model);

        this.home = model["home"];
        this.assetURL = model["assetURL"];
        this.username = model["username"];
        this.anon = model["anon"] === 'True';
        this.title = model["title"];
        this.tournamentDirector = model["tournamentDirector"];
        this.fen = model["fen"];
        this.profileid = model["profileid"]
        this.createMode = 'createGame';
        this.tcMode = 'real';
        this.selectedColor = 'r';
        this.selectedBoost = 0;
        this.validGameData = false;
        this.seeks = [];

        const onOpen = () => {
            console.log('onOpen()');
            const pending = this.pendingMessages;
            this.pendingMessages = [];
            pending.forEach(data => this.sock.send(data));
        }



        this.sock = createWebsocket('wsl', onOpen, () => { }, () => { }, (e: MessageEvent) => this.onMessage(e));

        setTimeout(() => {
            patch(document.querySelector('.seekbuttons') as HTMLElement, h('div.seekbuttons', this.renderSeekButtons()));
            patch(document.querySelector('.seekdialog') as HTMLElement, this.renderSeekDialog());

            const id01modal = document.getElementById('id01') as HTMLElement;
            if (id01modal) {
                document.addEventListener("click", (event) => {
                    if ((event.target as HTMLElement) == id01modal) this.closeSeekDialog();
                });
                id01modal.addEventListener("cancel", this.closeSeekDialog);
            }

            this.dialogHeaderEl = document.getElementById('header-block') as HTMLElement;

            const jouerEl = document.querySelector('.jouer-page') as HTMLElement | null;
            // « Nouvelle partie classée » en fin de partie : /jouer?classee=1 relance aussitôt la recherche
            if (jouerEl && new URLSearchParams(window.location.search).has('classee')) {
                window.history.replaceState({}, '', window.location.pathname);
                this.jouer.adv = 'classee';
                if (!this.anon) {
                    this.classeeDebut = Date.now();
                    this.doSend({ type: 'classee_chercher', variant: this.jouer.variant });
                }
            }
            if (jouerEl) {
                this.jouerEl = patch(jouerEl, this.renderJouer(model));
                // L'invitation d'installation du navigateur arrive après le chargement
                installeur()?.surChangement(() => this.majJouer(model));
            }

            // challenge (or CREATE GAME from the main menu)
            if (this.profileid !== "") {
                if (this.title === 'BOT') {
                    this.createMode = (this.profileid === 'Fairy-Stockfish') ? 'playAI' : 'playBOT';
                    this.preSelectVariant(model.variant);
                }
                else if (this.profileid === 'Invite-friend') this.createMode = 'playFriend';
                document.getElementById('game-mode')!.style.display = (this.anon || this.title === 'BOT') ? 'none' : 'inline-flex';
                this.renderDialogHeader(_('Challenge %1 to a game', this.profileid));
                document.getElementById('ailevel')!.style.display = this.createMode === 'playAI' ? 'block' : 'none';
                (document.getElementById('id01') as HTMLDialogElement).showModal();
                document.getElementById('color-selection-group')!.style.display = 'block';
                document.getElementById('create-button')!.style.display = 'block';

                // CREATE GAME from the main menu
                if (this.profileid === 'any#') {
                    this.profileid = '';
                    this.createGame();
                } else if (this.profileid === 'ai#') {
                    this.profileid = '';
                    this.playAI();
                } else if (this.profileid === 'friend#') {
                    this.profileid = '';
                    this.playFriend();
                }
            }

            // Seek from Editor with custom start position
            if (this.fen !== "" && this.profileid === "") {
                this.createGame(model.variant);
            }

            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('auto_ai')) {
                const lvl = parseInt(urlParams.get('auto_ai') || '1');
                const variantName = urlParams.get('variant') || 'matatakmini';
                this.createAIChallengeMsg(variantName, 'r', '', 0, 0, 0, lvl, false, false, false, false, 0);
            } else if (urlParams.get('ai')) {
                const lvl = parseInt(urlParams.get('ai') || '1');
                this.playAI();
                const aiLvlSelect = document.getElementById('ailevel-select') as HTMLSelectElement;
                if (aiLvlSelect) aiLvlSelect.value = String(lvl);
            }
        }, 0);

        const lobbyChatEl = document.getElementById('lobbychat');
        if (lobbyChatEl) {
            patch(lobbyChatEl, chatView(this, "lobbychat"));
        }

        this.streams = document.getElementById('streams') as HTMLElement;
        this.spotlights = document.getElementById('spotlights') as HTMLElement;



        setAriaTabClick("lobby_tab");

        const tabId = localStorage.lobby_tab ?? "tab-1";
        let initialEl = document.getElementById(tabId) as HTMLElement;
        if (initialEl === null) initialEl = document.getElementById('tab-1') as HTMLElement;
        if (initialEl) {
            initialEl.setAttribute('aria-selected', 'true');
            const targetPanel = initialEl.parentNode?.parentNode?.querySelector(`#${initialEl.getAttribute('aria-controls')}`) as HTMLElement;
            if (targetPanel) {
                targetPanel.style.display = 'block';
            }
        }

        const e = document.getElementById("fen") as HTMLInputElement;
        if (this.fen !== "")
            e.value = this.fen;

        if (!this.anon) {
            this.renderAutoPairingTable();
            this.autoPairingActions = document.querySelector('div.auto-pairing-actions') as HTMLElement | null;
        }

        boardSettings.assetURL = this.assetURL;
        boardSettings.updateBoardAndPieceStyles();
    }

    toggleAdvancedParams() {
        const e = document.getElementById('advanced-params') as HTMLInputElement;
        const advancedSettings = document.getElementById('advanced-settings-container') as HTMLElement;
        advancedSettings.style.display = e.checked ? 'block' : 'none';
        localStorage.seek_advanced_params = String(e.checked);
    }

    doSend(message: JSONObject) {
        // console.log("---> lobby doSend():", message);
        const data = JSON.stringify(message);
        if (this.sock.ws.readyState === WebSocket.OPEN) this.sock.send(data);
        else this.pendingMessages.push(data);
    }

    createSeekMsg(variant: string, color: string, fen: string, minutes: number, increment: number, byoyomiPeriod: number, day: number, chess960: boolean, rated: boolean, rrMin: number, rrMax: number, draft: boolean) {
        this.doSend({
            type: "create_seek",
            user: this.username,
            target: this.profileid,
            variant: variant,
            fen: fen,
            minutes: minutes,
            increment: increment,
            byoyomiPeriod: byoyomiPeriod,
            day: day,
            rated: rated,
            rrmin: rrMin,
            rrmax: rrMax,
            chess960: chess960,
            color: color,
            draft: draft
        });
    }

    createInviteFriendMsg(variant: string, color: string, fen: string, minutes: number, increment: number, byoyomiPeriod: number, day: number, chess960: boolean, rated: boolean, draft: boolean, boost: number) {
        this.doSend({
            type: "create_invite",
            user: this.username,
            target: 'Invite-friend',
            variant: variant,
            fen: fen,
            minutes: minutes,
            increment: increment,
            byoyomiPeriod: byoyomiPeriod,
            day: day,
            rated: rated,
            chess960: chess960,
            color: color,
            draft: draft,
            boost: boost
        });
    }

    createBOTChallengeMsg(variant: string, color: string, fen: string, minutes: number, increment: number, byoyomiPeriod: number, chess960: boolean, rated: boolean, draft: boolean, boost: number) {
        this.doSend({
            type: "create_bot_challenge",
            user: this.username,
            target: 'BOT_challenge',
            variant: variant,
            fen: fen,
            minutes: minutes,
            increment: increment,
            byoyomiPeriod: byoyomiPeriod,
            rated: rated,
            chess960: chess960,
            color: color,
            profileid: this.profileid,
            draft: draft,
            boost: boost
        });
    }

    createAIChallengeMsg(variant: string, color: string, fen: string, minutes: number, increment: number, byoyomiPeriod: number, level: number, rm: boolean, chess960: boolean, rated: boolean, draft: boolean, boost: number) {
        this.doSend({
            type: "create_ai_challenge",
            rm: rm,
            user: this.username,
            variant: variant,
            fen: fen,
            minutes: minutes,
            increment: increment,
            byoyomiPeriod: byoyomiPeriod,
            rated: rated,
            level: level,
            chess960: chess960,
            color: color,
            profileid: (this.profileid === "") ? "Fairy-Stockfish" : this.profileid,
            draft: draft,
            boost: boost
        });
    }

    createHostMsg(variant: string, color: string, fen: string, minutes: number, increment: number, byoyomiPeriod: number, chess960: boolean, rated: boolean, draft: boolean, boost: number) {
        this.doSend({
            type: "create_host",
            user: this.username,
            target: 'Invite-friend',
            variant: variant,
            fen: fen,
            minutes: minutes,
            increment: increment,
            byoyomiPeriod: byoyomiPeriod,
            rated: rated,
            chess960: chess960,
            color: color,
            draft: draft,
            boost: boost
        });
    }

    isNewSeek(variant: string, color: string, fen: string, minutes: number, increment: number, byoyomiPeriod: number, day: number, chess960: boolean, rated: boolean, draft: boolean, boost: number) {
        // console.log("isNewSeek()?", variant, color, fen, minutes, increment, byoyomiPeriod, chess960, rated);
        // console.log(this.seeks);
        return !this.seeks.some(seek =>
            seek.user === this.username &&
            seek.variant === variant &&
            seek.fen === fen &&
            seek.color === color &&
            seek.base === minutes &&
            seek.inc === increment &&
            seek.byoyomi === byoyomiPeriod &&
            seek.day === day &&
            seek.chess960 === chess960 &&
            seek.rated === rated &&
            seek.draft == draft &&
            seek.boost == boost
        );
    }

    closeSeekDialog() {
        (document.getElementById('id01') as HTMLDialogElement).close();
        (document.activeElement as HTMLElement).blur();
    }

    createSeek(color: string) {
        this.closeSeekDialog();
        if (!this.validGameData) return;

        let e;
        const variantRadio = document.querySelector('input[name="variant-radio"]:checked') as HTMLInputElement;
        const variant = VARIANTS[variantRadio.value];
        localStorage.seek_variant = variant.name;

        // TODO Standardize seek color
        let seekColor;
        if (variant.name.endsWith('shogi') && color !== 'r')
            seekColor = (color === 'w') ? 'b' : 'w';
        else
            seekColor = color;

        e = document.getElementById('fen') as HTMLInputElement;
        let fen = e.value;
        // Prevent to create 'custom' games with standard startFen
        if (variant.name !== 'ataxx' && fen.trim() === variant.startFen) fen = '';

        e = document.getElementById('min') as HTMLInputElement;
        const minutes = this.minutesValues[Number(e.value)];
        localStorage.seek_min = e.value;

        e = document.getElementById('inc') as HTMLInputElement;
        const increment = this.incrementValues[Number(e.value)];
        localStorage.seek_inc = e.value;

        e = document.getElementById('byo') as HTMLInputElement;
        const byoyomi = variant.rules.defaultTimeControl === "byoyomi";
        const byoyomiPeriod = (byoyomi && increment > 0) ? Number(e.value) : 0;
        localStorage.seek_byo = e.value;

        let day = 0;

        e = document.querySelector('input[name="mode"]:checked') as HTMLInputElement;
        let rated: boolean;
        if (this.createMode === 'playAI' ||
            this.anon ||
            this.title === "BOT" ||
            fen !== "" ||
            (minutes < 1 && increment === 0) ||
            (minutes === 0 && increment === 1)
        )
            rated = false;
        else
            rated = e.value === "1";
        localStorage.seek_rated = e.value;

        e = document.getElementById('rating-min') as HTMLInputElement;
        const rrMin = Number(e.value);
        localStorage.seek_rating_min = e.value;

        e = document.getElementById('rating-max') as HTMLInputElement;
        const rrMax = Number(e.value);
        localStorage.seek_rating_max = e.value;

        e = document.getElementById('chess960') as HTMLInputElement;
        const chess960 = (variant.chess960 && fen.trim() === "") ? e.checked : false;
        localStorage.seek_chess960 = e.checked;

        e = document.getElementById('draft') as HTMLInputElement;
        const isDraft = e.checked;
        localStorage.seek_draft = e.checked;

        e = document.querySelector('input[name="boost"]:checked') as HTMLInputElement;
        const boost = Number(e.value);
        localStorage.seek_boost = e.value;

        // console.log("CREATE SEEK variant, color, fen, minutes, increment, hide, chess960", variant, color, fen, minutes, increment, chess960, rated, rrMin, rrMax);

        switch (this.createMode) {
            case 'playAI':
                e = document.querySelector('input[name="level"]:checked') as HTMLInputElement;
                const level = Number(e.value);
                localStorage.seek_level = e.value;
                const rm = false;
                this.createAIChallengeMsg(variant.name, seekColor, fen, minutes, increment, byoyomiPeriod, level, rm, chess960, rated, isDraft, boost);
                break;
            case 'playBOT':
                this.createBOTChallengeMsg(variant.name, seekColor, fen, minutes, increment, byoyomiPeriod, chess960, rated, isDraft, boost);
                break;
            case 'playFriend':
                this.createInviteFriendMsg(variant.name, seekColor, fen, minutes, increment, byoyomiPeriod, day, chess960, rated, isDraft, boost);
                break;
            case 'createHost':
                this.createHostMsg(variant.name, seekColor, fen, minutes, increment, byoyomiPeriod, chess960, rated, isDraft, boost);
                break;
            default:
                if (this.isNewSeek(variant.name, seekColor, fen, minutes, increment, byoyomiPeriod, day, chess960, rated, isDraft, boost))
                    this.createSeekMsg(variant.name, seekColor, fen, minutes, increment, byoyomiPeriod, day, chess960, rated, rrMin, rrMax, isDraft);
        }
        // prevent to create challenges continuously
        this.profileid = '';
        window.history.replaceState({}, this.title, window.location.pathname);

        // We need to ask the user for permission
        notify(null, undefined);
    }

    renderDialogHeader(header: string) {
        this.dialogHeaderEl = patch(this.dialogHeaderEl, h('div#header-block', [h('h2', header)]));
    }

    private majJouer(model?: PyChessModel) {
        ecrireJouerChoix(this.jouer);
        if (model) this.jouerModel = model;
        if (this.jouerEl && this.jouerModel) this.jouerEl = patch(this.jouerEl, this.renderJouer(this.jouerModel));
    }

    /** Classements du joueur pour l'onglet « Classée » (une fois par visite). */
    private chargerClassee() {
        // Classements, joueurs en ligne et palmarès de la semaine : à l'ouverture de l'onglet, puis
        // toutes les 10 s tant qu'il est ouvert (un seul minuteur pour la page)
        if (this.classee) return;
        this.classee = { connecte: !this.anon };
        const charger = () => {
            chargerPalmares().then(p => { this.palmares = p; this.majJouer(); }).catch(() => { /* hors ligne */ });
            if (!this.anon) fetch('/api/classee', { credentials: 'same-origin' })
                .then(r => r.json())
                .then((infos: ClasseeInfos) => { this.classee = infos; this.majJouer(); })
                .catch(() => { /* hors ligne : on réessaiera au prochain rafraîchissement */ });
        };
        charger();
        this.classeeRafraichi = window.setInterval(() => { if (this.jouer.adv === 'classee') charger(); }, 10000);
    }

    private defier(adversaire: string) {
        this.defiMessage = '';
        this.doSend({ type: 'classee_defier', variant: this.jouer.variant, adversaire });
    }

    private onMsgDefi(msg: Record<string, any>) {
        if (msg.type === 'classee_defi') {
            this.defisRecus = [...this.defisRecus.filter(d => d.de !== msg.de), msg as DefiRecu];
            sound.genericNotify();
        } else if (msg.type === 'classee_defi_envoye') {
            this.defiEnvoye = { id: msg.id, a: msg.a };
        } else if (msg.type === 'classee_defi_fin') {
            this.defisRecus = this.defisRecus.filter(d => d.id !== msg.id);
            const envoye = this.defiEnvoye && (this.defiEnvoye.id === msg.id || msg.id === null);
            if (envoye || msg.id === null) {
                const message = FIN_DEFI[msg.raison];
                this.defiMessage = message ? message(msg.a ?? '') : '';
                this.defiEnvoye = null;
            }
        }
        this.majJouer();
    }

    private repondreDefi(defi: DefiRecu, accepte: boolean) {
        this.doSend({ type: 'classee_defi_reponse', id: defi.id, accepte });
        if (!accepte) this.defisRecus = this.defisRecus.filter(d => d.id !== defi.id);
        this.majJouer();
    }

    /** Défi reçu : un bandeau en haut de /jouer, quel que soit l'onglet ouvert. */
    private renderDefisRecus(): VNode | string {
        const defi = this.defisRecus[0];
        if (!defi) return '';
        const v: ClasseeVariante = { r: defi.r, prov: defi.prov, nb: 0, cadence: defi.cadence };
        return h('div.defi-recu', { attrs: { role: 'alertdialog', 'aria-label': `${defi.de} vous défie` } }, [
            h('div.defi-txt', [
                h('b', `${defi.de} vous défie`),
                h('small', `${texteClassement(v)} · Draft ${NOM_PLATEAU[defi.variant]} · ${defi.cadence.replace('+', ' min +')} · classée`),
            ]),
            h('div.defi-actions', [
                h('button.mt-btn.mt-btn-or.mt-btn-petit', { attrs: { type: 'button' }, on: { click: () => this.repondreDefi(defi, true) } }, 'Accepter'),
                h('button.defi-refuser', { attrs: { type: 'button' }, on: { click: () => this.repondreDefi(defi, false) } }, 'Refuser'),
            ]),
        ]);
    }

    /** Palmarès de la semaine : sa place, le podium, le lien vers la page. */
    private renderPalmaresSemaine(): VNode | string {
        const p = this.palmares;
        if (!p) return '';
        const podium = p.top.slice(0, 3);
        return h('div.palmares-semaine', [
            h('div.etiq', ['Palmarès de la semaine', h('a', { attrs: { href: '/palmares' } }, 'Voir tout')]),
            p.moi
                ? h('p.ma-place', [h('b', rangTexte(p.moi.rang)), ` sur ${p.joueurs} · ${p.moi.p} points`])
                : h('p.ma-place', "Chaque partie classée rapporte des points, même perdue. Remise à zéro le lundi, couronne au premier."),
            podium.length ? h('ol', podium.map((l, i) => h('li', { class: { moi: l.u === this.username } }, [
                h('span.rang', String(i + 1)),
                h('span.nom', [p.couronne === l.u ? couronne() : '', l.u]),
                h('span.pts', `${l.p} pts`),
            ]))) : '',
        ]);
    }

    /** Joueurs connectés sur /jouer, les plus proches de son classement d'abord, à défier. */
    private renderEnLigne(infos: ClasseeInfos, attente: boolean): VNode {
        const c = this.jouer;
        const moi = infos[c.variant]?.r ?? 1500;
        const tous = infos.en_ligne ?? [];
        const proches = [...tous].sort((x, y) => Math.abs(x[c.variant].r - moi) - Math.abs(y[c.variant].r - moi)).slice(0, 6);
        const action = (j: JoueurEnLigne) => {
            if (j.en_partie) return h('span.etat', 'En partie');
            if (this.defiEnvoye?.a === j.u) return h('button.defi.envoye', {
                attrs: { type: 'button', title: 'Annuler le défi' },
                on: { click: () => this.doSend({ type: 'classee_defi_reponse', id: this.defiEnvoye!.id, annuler: true }) },
            }, 'Défi envoyé…');
            return h('button.defi', { attrs: { type: 'button', disabled: attente || !!this.defiEnvoye }, on: { click: () => this.defier(j.u) } }, 'Défier');
        };
        return h('div.en-ligne', [
            h('div.etiq', ['Joueurs en ligne', tous.length ? h('b', String(tous.length)) : '']),
            proches.length
                ? h('ul', proches.map(j => h('li', [
                    h('a.nom', { attrs: { href: '/@/' + j.u } }, [this.palmares?.couronne === j.u ? couronne() : '', j.u]),
                    h('span.r', texteClassement(j[c.variant])),
                    action(j),
                ])))
                : h('p.vide', "Personne d'autre en ligne pour l'instant."),
            this.defiMessage ? h('p.defi-message', { attrs: { role: 'status' } }, this.defiMessage) : '',
        ]);
    }

    private chercherClassee() {
        if (this.classeeDebut) return;
        this.classeeDebut = Date.now(); // tout de suite, sans attendre la réponse du serveur
        this.doSend({ type: 'classee_chercher', variant: this.jouer.variant });
        this.majJouer();
    }

    private annulerClassee() {
        this.doSend({ type: 'classee_annuler' });
        this.onMsgClassee(false);
    }

    /** Panneau de l'onglet « Classée » : connexion obligatoire, puis un plateau et un bouton. */
    private renderClassee(choixAdv: VNode, plateau: (v: 'matatak' | 'matatakmini', infos: VNode) => VNode): VNode {
        const c = this.jouer;
        const infos = this.classee;
        if (!infos || !infos.connecte) {
            return h('section.panneau.partie.classee', [
                choixAdv,
                h('div.classee-accueil', [
                    h('b', 'Montez au classement'),
                    h('p', "Affrontez des joueurs de votre niveau : chaque victoire vous fait gagner des points, chaque défaite en coûte. Il faut un compte pour garder vos points."),
                ]),
                h('a.mt-btn.mt-btn-or.mt-btn-large.lancer', { attrs: { href: '/connexion' } }, 'Se connecter'),
                h('small.classee-note', "Gratuit. D'autres façons de se connecter arriveront bientôt."),
                this.renderPalmaresSemaine(),
            ]);
        }
        const v = infos[c.variant];
        const attente = this.classeeDebut > 0;
        const secondes = attente ? Math.floor((Date.now() - this.classeeDebut) / 1000) : 0;
        const ligne = (x?: ClasseeVariante) => h('small', `Classement ${texteClassement(x)}`);
        return h('section.panneau.partie.classee', [
            choixAdv,
            h('div.etiq', 'Plateau'),
            h('div.plateaux', { class: { inactif: attente } }, [
                plateau('matatakmini', ligne(infos.matatakmini)),
                plateau('matatak', ligne(infos.matatak)),
            ]),
            h('div.classee-regles', [
                h('span', [h('b', 'Draft'), ` · ${v ? v.cadence.replace('+', ' min +') : ''}`]),
                h('small', "Si personne de votre niveau n'est en ligne, un adversaire d'entraînement prend la place."),
            ]),
            attente
                ? h('div.classee-attente', [
                    h('button.mt-btn.mt-btn-or.mt-btn-large.lancer', { attrs: { type: 'button', disabled: true } },
                        `Recherche… ${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, '0')}`),
                    h('button.deja', { attrs: { type: 'button' }, on: { click: () => this.annulerClassee() } }, 'Annuler'),
                ])
                : h('button.mt-btn.mt-btn-or.mt-btn-large.lancer', {
                    attrs: { type: 'button' },
                    on: { click: () => this.chercherClassee() },
                }, 'Jouer une partie classée'),
            this.renderEnLigne(infos, attente),
            this.renderPalmaresSemaine(),
        ]);
    }

    private lancerJouer(model: PyChessModel) {
        if (this.jouerEnvoi) return;
        const c = this.jouer;
        const cadences = c.adv === 'ia' ? CADENCES_IA : CADENCES_AMI;
        const tc = cadences.find(x => x.id === c.tc) ?? cadences[0];
        this.jouerEnvoi = true;
        this.majJouer(model);
        this.profileid = '';
        // Même équipe : on tire la couleur ici pour envoyer la position vue du bon côté
        let color: string = c.color;
        let fen = this.jouerDraft ? '' : this.jouerFen.trim();
        const boost = c.adv === 'ia' ? 0 : this.jouerBoost; // Coup de pouce : entre amis seulement
        const avecOptions = this.jouerDraft || boost !== 0 || fen !== '';
        const equipe = c.equipe === 'garder' && !avecOptions ? equipeMemorisee(c.variant) : null;
        if (equipe) {
            const couleur = c.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : c.color;
            color = couleur;
            fen = fenPourCouleur(equipe, couleur);
        }
        if (c.adv === 'ia') {
            this.createMode = 'playAI';
            this.createAIChallengeMsg(c.variant, color, fen, tc.min, tc.inc, 0, c.level, false, false, false, this.jouerDraft, 0);
        } else {
            this.createMode = 'playFriend';
            this.createInviteFriendMsg(c.variant, color, fen, tc.min, tc.inc, 0, 0, false, false, this.jouerDraft, boost);
        }
        // Si le serveur ne répond pas (connexion coupée), on peut réessayer.
        setTimeout(() => { this.jouerEnvoi = false; this.majJouer(model); }, 8000);
    }

    /** Options de /jouer cachées par défaut : cadence, qui commence, équipes, puis Draft, Coup de pouce
     *  (contre un ami seulement), position de départ (remplace l'ancienne fenêtre de pychess). */
    private renderPlusOptions(maj: () => void, reglages: VNode[], ia: boolean): VNode {
        const boost = this.jouerBoost;
        return h('div#plus-options.plus-options', [
            ...reglages,
            h('label.interrupteur', [
                h('input', {
                    props: { type: 'checkbox', checked: this.jouerDraft },
                    on: { change: (e: Event) => { this.jouerDraft = (e.target as HTMLInputElement).checked; maj(); } },
                }),
                h('span.glissiere'),
                h('span', [h('b', 'Draft'), h('small', "Les Personnages sont tirés au hasard. L'un forme deux groupes, l'autre choisit le sien, puis chacun place son équipe.")]),
            ]),
            // Coup de pouce (règle du livret) : entre amis seulement ; en Solo, on choisit un niveau plus facile
            ia ? '' : h('div.bloc.pouce', { class: { inactif: this.jouerDraft } }, [
                h('div.etiq', [h('label', { attrs: { for: 'jouer-pouce' } }, 'Coup de pouce'),
                    h('b', this.jouerDraft ? 'Sans effet en Draft' : boost === 0 ? 'Aucun' : `${boost > 0 ? 'Pour vous' : 'Pour votre ami'} · ${Math.abs(boost)}`)]),
                h('input#jouer-pouce', {
                    props: { type: 'range', min: -4, max: 4, step: 1, value: boost, disabled: this.jouerDraft },
                    style: { '--f': `${(boost + 4) / 8}` },
                    on: { input: (e: Event) => { this.jouerBoost = Number((e.target as HTMLInputElement).value); maj(); } },
                }),
                h('div.reperes-pouce', [h('span', 'Votre ami'), h('span', 'Équilibré'), h('span', 'Vous')]),
                h('small.aide', texteCoupDePouce(boost)),
            ]),
            h('div.bloc', { class: { inactif: this.jouerDraft } }, [
                h('label.etiq', { attrs: { for: 'jouer-fen' } }, 'Position de départ'),
                h('input#jouer-fen', {
                    props: { value: this.jouerFen, disabled: this.jouerDraft },
                    attrs: { placeholder: 'Coller une FEN (vide : position tirée au hasard)', autocomplete: 'off', spellcheck: 'false' },
                    on: { input: (e: Event) => { this.jouerFen = (e.target as HTMLInputElement).value; } },
                }),
            ]),
        ]);
    }

    renderJouer(model: PyChessModel): VNode {
        this.jouerModel = model; // pour les mises à jour venues du serveur (majJouer sans modèle)
        const c = this.jouer;
        const ia = c.adv === 'ia';
        const maj = () => this.majJouer(model);
        const cadences = ia ? CADENCES_IA : CADENCES_AMI;
        if (c.adv !== 'classee' && !cadences.some(x => x.id === c.tc)) c.tc = ia ? '0+0' : '5+3';

        const bouton = (actif: boolean, sel: string, onClick: () => void, contenu: (VNode | string)[], attrs: Record<string, string> = {}) =>
            h(sel, { class: { on: actif }, attrs: { type: 'button', 'aria-pressed': String(actif), ...attrs }, on: { click: onClick } }, contenu);


        const camps: [JouerChoix['color'], string, string][] = [
            ['w', 'Je commence', 'clair'],
            ['r', 'Au hasard', 'hasard'],
            ['b', 'En second', 'sombre'],
        ];

        const reglages = [
            h('div.bloc', [
                h('div.etiq', 'Cadence'),
                h('div.cadences', cadences.map(x =>
                    bouton(c.tc === x.id, 'button.cadence', () => { c.tc = x.id; maj(); }, [x.label, ...(x.detail ? [h('small', x.detail)] : [])])
                )),
            ]),
            h('div.bloc', [
                h('div.etiq', 'Qui commence ?'),
                h('div.camp', { attrs: { role: 'group', 'aria-label': 'Qui commence ?' } }, camps.map(([v, label, cls]) =>
                    bouton(c.color === v, 'button', () => { c.color = v; maj(); }, [h(`i.${cls}`), h('span', label)], { title: label })
                )),
            ]),
            // « Garder les mêmes équipes » retiré du menu (Hugo, 21/10/2026) : le code reste (equipe.ts)
        ];

        // Options repliées : on rappelle ce qui sera joué (cadence toujours, le reste seulement s'il a changé).
        const cadence = cadences.find(x => x.id === c.tc) ?? cadences[0];
        const resume = [
            cadence.detail ? `${cadence.label} ${cadence.detail}` : cadence.label,
            c.color === 'w' ? 'vous commencez' : c.color === 'b' ? 'en second' : '',
            this.jouerDraft ? 'Draft' : '',
            !ia && !this.jouerDraft && this.jouerBoost !== 0 ? `Coup de pouce ${this.jouerBoost > 0 ? 'pour vous' : 'pour votre ami'}` : '',
            !this.jouerDraft && this.jouerFen.trim() ? 'position choisie' : '',
        ].filter(x => x).join(' · ');

        // Pendant une recherche classée, changer d'onglet annule la recherche
        const choisirAdv = (adv: JouerAdversaire) => {
            if (this.classeeDebut && adv !== 'classee') this.annulerClassee();
            c.adv = adv;
            maj();
        };
        const choixAdv = h('div.choix-adv', { attrs: { role: 'group', 'aria-label': 'Adversaire' } }, [
            bouton(c.adv === 'ia', 'button', () => choisirAdv('ia'), [h('img', { attrs: { src: IMG_VITRINE + IMG_ROI[saisonDuNiveau(c.level)], alt: '' } }), 'Solo']),
            bouton(c.adv === 'ami', 'button', () => choisirAdv('ami'), [h('img', { attrs: { src: IMG_VITRINE + '11-frank.webp', alt: '' } }), 'Contre un ami']),
            bouton(c.adv === 'classee', 'button', () => choisirAdv('classee'), [h('img', { attrs: { src: IMG_VITRINE + '26-rokk.webp', alt: '' } }), 'Classée']),
        ]);
        const plateau = (v: 'matatak' | 'matatakmini', detail: VNode) =>
            bouton(c.variant === v, 'button.plat', () => { if (!this.classeeDebut) { c.variant = v; maj(); } }, [
                damier(v === 'matatak' ? 8 : 4), h('span', [h('b', v === 'matatak' ? 'Matatak' : 'Matatak Mini'), detail]),
            ]);

        if (c.adv === 'classee') {
            this.chargerClassee();
            const v = this.classee?.[c.variant];
            const scene = h('aside.scene', { key: 'classee' }, [
                h('div.scene-cartes', [carteTournante('26-rokk.webp')]),
                this.classee?.connecte
                    ? h('div.scene-txt', [h('b', v ? String(v.r) : '…'), h('span', `${v?.prov ? 'Classement provisoire' : 'Votre classement'} · ${c.variant === 'matatak' ? 'Matatak' : 'Matatak Mini'}`)])
                    : h('div.scene-txt', [h('b', 'Classée'), h('span', 'Gagnez des points, grimpez au classement')]),
            ]);
            const installation = bandeauInstallation(maj);
            return h('div.jouer-page', [this.renderDefisRecus(), h('div.grille', [this.renderClassee(choixAdv, plateau), scene]), installation ?? '']);
        }

        const partie = h('section.panneau.partie', [
            choixAdv,
            h('div.etiq', 'Plateau'),
            h('div.plateaux', [
                plateau('matatakmini', h('small', '4 × 8 · rapide et facile')),
                plateau('matatak', h('small', '8 × 8 · grand format')),
            ]),
            ia ? h('div.niveau', [
                h('div.etiq', [h('label', { attrs: { for: 'jouer-niveau' } }, 'Adversaire'), h('b', `${roiDuNiveau(c.level)} · Niveau ${c.level}`)]),
                h('div.curseur', [
                    h('button.pas', { attrs: { type: 'button', 'aria-label': 'Niveau plus faible' }, on: { click: () => { c.level = Math.max(1, c.level - 1); maj(); } } }, '−'),
                    h('input#jouer-niveau', {
                        props: { type: 'range', min: 1, max: 20, value: c.level },
                        style: { '--f': `${(c.level - 1) / 19}` },
                        on: { input: (e: Event) => { c.level = Number((e.target as HTMLInputElement).value); maj(); } },
                    }),
                    h('button.pas', { attrs: { type: 'button', 'aria-label': 'Niveau plus fort' }, on: { click: () => { c.level = Math.min(20, c.level + 1); maj(); } } }, '+'),
                ]),
                // Un Roi par palier de 5 niveaux
                h('div.reperes', (['ete', 'automne', 'hiver', 'printemps'] as const).map(sa =>
                    h('span', { class: { actif: saisonDuNiveau(c.level) === sa } }, ROIS[sa].nom))),
            ]) : '',
            h('button.plus', {
                attrs: { type: 'button', 'aria-expanded': String(this.jouerOptions), 'aria-controls': 'plus-options' },
                on: { click: () => { this.jouerOptions = !this.jouerOptions; maj(); } },
            }, this.jouerOptions ? [h('span', "Moins d'options")] : [h('span', "Plus d'options"), h('small', resume)]),
            this.jouerOptions ? this.renderPlusOptions(maj, reglages, ia) : '',
            // Nouveau joueur (tutoriel ni fini ni écarté sur cet appareil) : on apprend d'abord.
            // Contre un ami, on ne bloque pas : c'est l'ami qui peut montrer les règles.
            ...(ia && !reglesConnues() ? [
                h('a.mt-btn.mt-btn-or.mt-btn-large.lancer', { attrs: { href: `/tutorial/${etapeTutoriel() + 1}` } },
                    etapeTutoriel() > 0 ? 'Reprendre le tutoriel' : 'Apprendre à jouer'),
                h('button.deja', { attrs: { type: 'button' }, on: { click: () => { noterReglesConnues(); maj(); } } }, 'Je connais déjà les règles'),
            ] : [
                h('button.mt-btn.mt-btn-or.mt-btn-large.lancer', {
                    attrs: { type: 'button', disabled: this.jouerEnvoi },
                    on: { click: () => this.lancerJouer(model) },
                }, this.jouerEnvoi ? 'Préparation…' : (ia ? 'Lancer la partie' : 'Inviter un ami')),
            ]),
        ]);

        // À côté du panneau (ordinateur) : l'adversaire en grand, qui change avec le curseur
        const saison = saisonDuNiveau(c.level);
        const roi = ROIS[saison];
        const debut = Math.floor((c.level - 1) / 5) * 5 + 1;
        const scene = ia
            ? h('aside.scene', { key: 'roi-' + saison }, [
                h('div.scene-cartes', [carteTournante(IMG_ROI[saison])]),
                h('div.scene-txt', [
                    h('b', roi.nom),
                    h('span', `${roi.titre} · niveaux ${debut} à ${debut + 4}`),
                    h('q', roi.replique),
                ]),
            ])
            : h('aside.scene.duo', { key: 'ami' }, [
                h('div.scene-cartes', [duoEchange('11-frank.webp', '10-krak.webp')]),
                h('div.scene-txt', [h('b', 'Entre amis')]),
            ]);

        // Collection, Analyse et Éditeur sont rangés dans « Apprendre » ; « Installer l'appli » aussi,
        // et dans le bandeau du bas (bandeauInstallation)
        const installation = bandeauInstallation(maj);
        return h('div.jouer-page', [this.renderDefisRecus(), h('div.grille', [partie, scene]), installation ?? '']);
    }

    renderSeekButtons() {
        if (window.location.pathname === '/jouer') return [];

        // Standard /lobby page buttons
        return [
            h('button.lobby-button', { on: { click: () => this.createGame() } }, createModeStr('createGame')),
            h('button.lobby-button', { on: { click: () => this.createHost() }, style: { display: this.tournamentDirector ? "block" : "none" } }, createModeStr('createHost')),
        ];
    }

    renderSeekDialog() {
        const vVariant = localStorage.seek_variant || "matatak";
        const twoBoards = VARIANTS[vVariant].twoBoards;
        // 5+3 default TC needs vMin 9 because of the partial numbers at the beginning of minutesValues
        const vMin = localStorage.seek_min ?? "9";
        const vInc = localStorage.seek_inc ?? "3";
        const vByoIdx = (localStorage.seek_byo ?? 1) - 1;
        const vDay = localStorage.seek_day ?? "1";
        const vRated = twoBoards ? "0" : localStorage.seek_rated ?? "0";
        const vRatingMin = localStorage.seek_rating_min ?? -1000;
        const vRatingMax = localStorage.seek_rating_max ?? 1000;
        const vLevel = Number(localStorage.seek_level ?? "1");
        const vChess960 = localStorage.seek_chess960 ?? "false";
        const vRMplay = localStorage.seek_rmplay ?? "false";
        const vAdvancedParams = localStorage.seek_advanced_params ?? "false";
        const vDraft = localStorage.seek_draft ?? "false";
        const vBoost = Number(localStorage.seek_boost ?? "0");
        return h('dialog#id01.modal', [
            h('form.modal-content', [
                h('span#closecontainer', [
                    h('span.close', {
                        on: { click: this.closeSeekDialog },
                        attrs: { 'data-icon': 'j' }, props: { title: _("Cancel") }
                    }),
                ]),
                h('div.container', [
                    h('div', [
                        h('div#header-block'),
                        h('div.radio-group.variant-radio-group', { style: { marginBottom: '20px' } }, [
                            h('input#radio-matatak', {
                                props: { type: "radio", name: "variant-radio", value: "matatak" },
                                attrs: { checked: vVariant === 'matatak' },
                                on: { change: () => this.setVariant() }
                            }),
                            h('label', { attrs: { for: "radio-matatak" } }, 'Matatak'),
                            h('input#radio-matatakmini', {
                                props: { type: "radio", name: "variant-radio", value: "matatakmini" },
                                attrs: { checked: vVariant === 'matatakmini' },
                                on: { change: () => this.setVariant() }
                            }),
                            h('label', { attrs: { for: "radio-matatakmini" } }, 'Matatak Mini')
                        ]),
                        // A.I.Level (1-20 buttons in 4 rows)
                        h('form#ailevel', [
                            h('h4', _("Level")),
                            h('div',
                                [0, 1, 2, 3].map(row =>
                                    h('div.radio-group', { style: { display: 'flex', width: '100%', marginBottom: row < 3 ? '5px' : '20px' } },
                                        Array.from({length: 5}, (_, i) => row * 5 + i + 1).map(level => [
                                            h('input#ai' + level, { props: { type: "radio", name: "level", value: level }, attrs: { checked: vLevel === level } }),
                                            h('label.level-ai.ai' + level, { attrs: { for: "ai" + level }, style: { flex: 1, textAlign: 'center' } }, level),
                                        ]).reduce((arr, v) => (arr.push(...v), arr), []) // flatmap
                                    )
                                )
                            ),
                        ]),
                        h('div#advanced-params-block', [
                            h('label.icon.icon-cog', { attrs: { for: "advanced-params" }, props: { title: _("Advanced Settings") }, style: { cursor: 'pointer', fontSize: '1.2em' } }),
                            h('input#advanced-params', {
                                props: {
                                    name: "advanced-params",
                                    type: "checkbox",
                                },
                                attrs: {
                                    checked: vAdvancedParams === "true"
                                },
                                on: { click: () => this.toggleAdvancedParams() },
                                hook: { insert: () => this.toggleAdvancedParams() },
                            }),
                        ]),
                        h('div#advanced-settings-container', [
                            h('input#fen', { props: { name: 'fen', placeholder: _('Paste the FEN text here') + (this.anon ? _(' (must be signed in)') : ''), autocomplete: "off" }, on: { input: () => this.setFen() }, }),
                            h('div#alternate-start-block'),
                            h('div#chess960-block', [
                                h('label', { attrs: { for: "chess960" } }, "Chess960"),
                                h('input#chess960', {
                                    props: {
                                        name: "chess960",
                                        type: "checkbox",
                                    },
                                    attrs: {
                                        checked: vChess960 === "true"
                                    },
                                }),
                            ]),
                            h('div#draft-block', [
                                h('label', { attrs: { for: "draft" } }, "Draft Mode"),
                                h('input#draft', {
                                    props: {
                                        name: "draft",
                                        type: "checkbox",
                                        title: _("Draft Mode"),
                                    },
                                    attrs: {
                                        checked: vDraft === "true"
                                    },
                                }),
                            ]),
                            h('div.tc-block', [
                                h('div', [
                                    h('label', { attrs: { for: "min" } }, _("Minutes per side:")),
                                    h('span#minutes'),
                                    h('input#min.slider', {
                                        props: { name: "min", type: "range", min: 0, max: this.minutesValues.length - 1, value: vMin },
                                        on: { input: e => this.setMinutes(parseInt((e.target as HTMLInputElement).value)) },
                                        hook: { insert: vnode => this.setMinutes(parseInt((vnode.elm as HTMLInputElement).value)) },
                                    }),
                                    h('label#incrementlabel', { attrs: { for: "inc" } }, ''),
                                    h('span#increment'),
                                    h('input#inc.slider', {
                                        props: { name: "inc", type: "range", min: 0, max: this.incrementValues.length - 1, value: vInc },
                                        on: { input: e => this.setIncrement(this.incrementValues[parseInt((e.target as HTMLInputElement).value)]) },
                                        hook: { insert: vnode => this.setIncrement(this.incrementValues[parseInt((vnode.elm as HTMLInputElement).value)]) },
                                    }),
                                    h('div#byoyomi-period', [
                                        h('label#byoyomiLabel', { attrs: { for: "byo" } }, _('Periods')),
                                        h('select#byo', {
                                            props: { name: "byo" },
                                        },
                                            [1, 2, 3].map((n, idx) => h('option', { props: { value: n }, attrs: { selected: (idx === vByoIdx) } }, n))
                                        ),
                                    ]),
                                ]),
                            ]),
                            h('form#game-mode', [
                                h('div.radio-group', [
                                    h('input#casual', {
                                        props: { type: "radio", name: "mode", value: "0" },
                                        attrs: { checked: vRated === "0" },
                                        on: { input: e => this.setCasual((e.target as HTMLInputElement).value) },
                                        hook: { insert: vnode => this.setCasual((vnode.elm as HTMLInputElement).value) },
                                    }),
                                    h('label', { attrs: { for: "casual" } }, _("Casual")),
                                    h('input#rated', {
                                        props: { type: "radio", name: "mode", value: "1" },
                                        attrs: { checked: vRated === "1", disabled: this.anon || twoBoards }, /*dont support rated bughouse atm*/
                                        on: { input: e => this.setRated((e.target as HTMLInputElement).value) },
                                        hook: { insert: vnode => this.setRated((vnode.elm as HTMLInputElement).value) },
                                    }),
                                    h('label', { attrs: { for: "rated" } }, _("Rated")),
                                ]),
                            ]),
                            h('div#rating-range-setting', [
                                _('Rating range'),
                                h('div.rating-range', [
                                    h('input#rating-min.slider', {
                                        props: { name: "rating-min", type: "range", min: -1000, max: 0, step: 50, value: vRatingMin },
                                        on: { input: e => this.setRatingMin(parseInt((e.target as HTMLInputElement).value)) },
                                        hook: { insert: vnode => this.setRatingMin(parseInt((vnode.elm as HTMLInputElement).value)) },
                                    }),
                                    h('div.rating-min', '-1000'),
                                    h('span', '/'),
                                    h('div.rating-max', '+1000'),
                                    h('input#rating-max.slider', {
                                        props: { name: "rating-max", type: "range", min: 0, max: 1000, step: 50, value: vRatingMax },
                                        on: { input: e => this.setRatingMax(parseInt((e.target as HTMLInputElement).value)) },
                                        hook: { insert: vnode => this.setRatingMax(parseInt((vnode.elm as HTMLInputElement).value)) },
                                    }),
                                ]),
                            ]),
                            h('div#color-selection-group.settings-block', [
                                h('h4', _("Color")),
                                h('div.radio-group', [
                                    h('input#color-white', { props: { type: "radio", name: "color", value: "w" }, on: { change: () => this.selectedColor = 'w' } }),
                                    h('label.icon.icon-white', { attrs: { for: "color-white" }, props: { title: _("White") } }),
                                    h('input#color-random', { props: { type: "radio", name: "color", value: "r", checked: true }, on: { change: () => this.selectedColor = 'r' } }),
                                    h('label.icon.icon-adjust', { attrs: { for: "color-random" }, props: { title: _("Random") } }),
                                    h('input#color-black', { props: { type: "radio", name: "color", value: "b" }, on: { change: () => this.selectedColor = 'b' } }),
                                    h('label.icon.icon-black', { attrs: { for: "color-black" }, props: { title: _("Black") } }),
                                ])
                            ]),
                            h('div#boost-selection-group.settings-block', [
                                h('h4', _("Boost")),
                                h('div.radio-group',
                                    [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(boost => [
                                        h(`input#boost${boost}`, { props: { type: "radio", name: "boost", value: boost }, attrs: { checked: vBoost === boost }, on: { change: () => this.selectedBoost = boost } }),
                                        h(`label.level-boost.boost${boost}`, { attrs: { for: `boost${boost}` } }, boost > 0 ? `+${boost}` : boost),
                                    ]).reduce((arr, v) => (arr.push(...v), arr), []) // flatmap
                                )
                            ]),
                        ]),
                        h('div#create-button', [
                            h('button', { props: { type: "button" }, on: { click: () => this.createSeek(this.selectedColor) } }, _("Play")),
                        ]),
                    ]),
                ]),
            ]),
        ])
    }

    autoPairingSelectAll() {
        document.querySelectorAll('input[name^="va_"]').forEach((inp: HTMLInputElement) => {
            inp.checked = true;
        });
        document.querySelectorAll('input[name^="tc_"]').forEach((inp: HTMLInputElement) => {
            inp.checked = true;
        });
    }

    autoPairingReset() {
        document.querySelectorAll('input[name^="va_"]').forEach((inp: HTMLInputElement) => {
            inp.checked = false;
        });
        document.querySelectorAll('input[name^="tc_"]').forEach((inp: HTMLInputElement) => {
            inp.checked = false;
        });
    }

    autoPairingCancel() {
        this.doSend({ type: "cancel_auto_pairing" });
    }

    autoPairingSubmit() {
        const variants: [string, boolean][] = [];
        document.querySelectorAll('input[name^="va_"]').forEach((inp: HTMLInputElement) => {
            localStorage[inp.name] = inp.checked;
            if (inp.checked) {
                const chess960 = inp.name.endsWith('960');
                const name = (chess960) ? inp.name.slice(3, -3) : inp.name.slice(3);
                variants.push([name, chess960]);
            }
        })

        const tcs: [number, number, number][] = [];
        document.querySelectorAll('input[name^="tc_"]').forEach((inp: HTMLInputElement, index: number) => {
            localStorage[inp.name] = inp.checked;
            if (inp.checked) tcs.push(autoPairingTCs[index]);
        })

        const minEle = document.getElementById('auto-rating-min') as HTMLInputElement;
        const rrMin = Number(minEle.value);
        localStorage.auto_rating_min = minEle.value;

        const maxEle = document.getElementById('auto-rating-max') as HTMLInputElement;
        const rrMax = Number(maxEle.value);
        localStorage.auto_rating_max = maxEle.value;

        this.doSend({ type: "create_auto_pairing", variants: variants, tcs: tcs, rrmin: rrMin, rrmax: rrMax });
    }

    preSelectVariant(variantName: string, chess960: boolean = false) {
        if (variantName !== '') {
            const radio = document.getElementById(`radio-${variantName}`) as HTMLInputElement;
            if (radio) radio.checked = true;

            this.setVariant();

            const check = document.getElementById("chess960") as HTMLInputElement;
            if (check) check.checked = chess960;
        }
    }

    renderVariantsDropDown(variantName: string = '', disabled: string[]) {
        let vVariant = variantName || localStorage.seek_variant || "matatak";
        if (disabled.includes(vVariant)) vVariant = "matatak";
        const vChess960 = localStorage.seek_chess960 === 'true' || false;

        this.preSelectVariant(vVariant, vChess960);
    }

    createGame(variantName: string = '') {
        const twoBoards = (variantName) ? VARIANTS[variantName].twoBoards : false;
        this.createMode = 'createGame';
        this.renderVariantsDropDown(variantName, this.anon ? twoBoarsVariants : []);
        this.renderDialogHeader(createModeStr(this.createMode));
        document.getElementById('game-mode')!.style.display = this.anon ? 'none' : 'inline-flex';
        document.getElementById('rating-range-setting')!.style.display = 'block';
        document.getElementById('ailevel')!.style.display = 'none';
        (document.getElementById('id01') as HTMLDialogElement).showModal();
        document.getElementById('color-selection-group')!.style.display = 'block';
        document.getElementById('boost-selection-group')!.style.display = 'none';
        document.getElementById('create-button')!.style.display = 'block';
    }

    playFriend(variantName: string = '') {
        this.createMode = 'playFriend';
        this.renderVariantsDropDown(variantName, twoBoarsVariants);
        this.renderDialogHeader(createModeStr(this.createMode))
        document.getElementById('game-mode')!.style.display = this.anon ? 'none' : 'inline-flex';
        document.getElementById('rating-range-setting')!.style.display = 'none';
        document.getElementById('ailevel')!.style.display = 'none';
        (document.getElementById('id01') as HTMLDialogElement).showModal();
        document.getElementById('color-selection-group')!.style.display = 'block';
        document.getElementById('boost-selection-group')!.style.display = 'block';
        document.getElementById('create-button')!.style.display = 'block';
    }

    playAI(variantName: string = '') {
        this.createMode = 'playAI';
        this.renderVariantsDropDown(variantName, twoBoarsVariants);
        this.renderDialogHeader(createModeStr(this.createMode))
        document.getElementById('game-mode')!.style.display = 'none';
        document.getElementById('rating-range-setting')!.style.display = 'none';
        document.getElementById('ailevel')!.style.display = 'inline-block';
        (document.getElementById('id01') as HTMLDialogElement).showModal();
        document.getElementById('boost-selection-group')!.style.display = 'block';
        document.getElementById('color-selection-group')!.style.display = 'block';
        document.getElementById('create-button')!.style.display = 'block';
    }

    createHost(variantName: string = '') {
        this.createMode = 'createHost';
        this.renderVariantsDropDown(variantName, twoBoarsVariants);
        this.renderDialogHeader(createModeStr(this.createMode))
        document.getElementById('game-mode')!.style.display = this.anon ? 'none' : 'inline-flex';
        document.getElementById('rating-range-setting')!.style.display = 'none';
        document.getElementById('ailevel')!.style.display = 'none';
        (document.getElementById('id01') as HTMLDialogElement).showModal();
        document.getElementById('color-selection-group')!.style.display = 'none';
        document.getElementById('create-button')!.style.display = 'block';
    }

    private setVariant() {
        let e;
        const variantRadio = document.querySelector('input[name="variant-radio"]:checked') as HTMLInputElement;
        const variantName = variantRadio ? variantRadio.value : "matatak";
        const variant = VARIANTS[variantName];
        const byoyomi = variant.rules.defaultTimeControl === "byoyomi";
        if (variant.twoBoards) {
            const select = document.getElementById('tc') as HTMLSelectElement;
            select.selectedIndex = 0;
            this.tcMode = 'real';
        }
        // TODO use toggle class instead of setting style directly
        document.getElementById('draft-block')!.style.display = (variant.name.startsWith('matatak')) ? 'block' : 'none';
        document.getElementById('chess960-block')!.style.display = variant.chess960 ? 'block' : 'none';
        document.getElementById('byoyomi-period')!.style.display = byoyomi ? 'block' : 'none';
        e = document.getElementById('fen') as HTMLInputElement;
        e.value = "";
        e = document.getElementById('incrementlabel') as HTMLSelectElement;
        patch(e, h('label#incrementlabel', { attrs: { for: "inc" } }, (byoyomi ? _('Byoyomi in seconds:') : _('Increment in seconds:'))));
        e = document.getElementById('alternate-start-block') as HTMLElement;
        e.innerHTML = "";
        if (variant.alternateStart) {
            patch(e, h('div#alternate-start-block', [
                h('label', { attrs: { for: "alternate-start" } }, _("Alternate Start")),
                h('select#alternate-start', {
                    props: { name: "alternate-start" },
                    on: { input: () => this.setAlternateStart(variant) },
                    hook: { insert: () => this.setAlternateStart(variant) },
                },
                    Object.keys(variant.alternateStart).map(alt =>
                        h('option', { props: { value: alt } }, _(alt))
                    )
                ),
            ]));
        }
        if (this.createMode === 'playAI') {
            document.getElementById('ailevel')!.style.display = 'inline-block';
        }
        switchEnablingLobbyControls(this.createMode, variant, this.anon);
        this.setStartButtons();
    }
    private setAlternateStart(variant: Variant) {
        let e: HTMLSelectElement;
        e = document.getElementById('alternate-start') as HTMLSelectElement;
        const alt = e.options[e.selectedIndex].value;
        e = document.getElementById('fen') as HTMLSelectElement;
        e.value = variant.alternateStart![alt];
        (document.getElementById('chess960') as HTMLInputElement).disabled = alt !== "";
        this.setFen();
    }
    private setMinutes(val: number) {
        const minutes = val < this.minutesStrings.length ? this.minutesStrings[val] : String(this.minutesValues[val]);
        document.getElementById("minutes")!.innerHTML = minutes;
        this.setStartButtons();
    }
    private setIncrement(increment: number) {
        document.getElementById("increment")!.innerHTML = "" + increment;
        this.setStartButtons();
    }
    private setDays(val: number) {
        const days = this.daysValues[val];
        document.getElementById("days")!.innerHTML = String(days);
        this.setStartButtons();
    }
    private setRatingMin(val: number) {
        document.querySelector("div.rating-min")!.innerHTML = '-' + String(Math.abs(val));
    }
    private setRatingMax(val: number) {
        document.querySelector("div.rating-max")!.innerHTML = '+' + String(val);
    }
    private setAutoRatingMin(val: number) {
        document.querySelector("div.auto-rating-min")!.innerHTML = '-' + String(Math.abs(val));
    }
    private setAutoRatingMax(val: number) {
        document.querySelector("div.auto-rating-max")!.innerHTML = '+' + String(val);
    }
    private setFen() {
        const e = document.getElementById('fen') as HTMLInputElement;
        e.setCustomValidity(this.validateFen() ? '' : _('Invalid FEN'));
        this.setStartButtons();
    }
    private setCasual(casual: string) {
        console.log("setCasual", casual);
        this.setStartButtons();
    }
    private setRated(rated: string) {
        console.log("setRated", rated);
        this.setStartButtons();
    }
    private setStartButtons() {
        this.validGameData = this.validateTimeControl() && this.validateFen();
        const e = document.getElementById('create-button') as HTMLElement;
        e.classList.toggle("disabled", !this.validGameData);
    }
    private validateTimeControl() {
        const min = Number((document.getElementById('min') as HTMLInputElement).value);
        const inc = Number((document.getElementById('inc') as HTMLInputElement).value);
        const minutes = this.minutesValues[min];

        const e = document.querySelector('input[name="mode"]:checked') as HTMLInputElement;
        const rated = e.value === "1";

        const atLeast = (this.createMode === 'playAI') ? ((min > 0 && inc > 0) || (min >= 1 && inc === 0)) : (min + inc > 0);
        const tooFast = (minutes < 1 && inc === 0) || (minutes === 0 && inc === 1);

        return atLeast && !(tooFast && rated);
    }
    private validateFen() {
        const variantRadio = document.querySelector('input[name="variant-radio"]:checked') as HTMLInputElement;
        const variant = variantRadio ? variantRadio.value : "matatak";
        const fen = (document.getElementById('fen') as HTMLInputElement).value;
        return fen === "" || validFen(VARIANTS[variant], fen);
    }

    renderSeeks(seeks: Seek[]) {
        seeks.sort((a, b) => (a.bot && !b.bot) ? 1 : -1);
        const rows = seeks.map(seek => this.seekView(seek));
        return [seekHeader(), h('tbody', rows)];
    }

    private seekViewRegular(seek: Seek) {
        const variant = VARIANTS[seek.variant];
        const chess960 = seek.chess960;

        return h('tr', { on: { click: () => this.onClickSeek(seek) } }, [
            h('td', [this.colorIcon(seek.color)]),
            h('td', [this.challengeIcon(seek), this.seekTitle(seek), this.user(seek)]),
            h('td', seek.rating),
            h('td', timeControlStr(seek.base, seek.inc, seek.byoyomi, seek.day)),
            h('td.icon', { attrs: { "data-icon": variant.icon(chess960) } }, [h('variant-name', " " + variant.displayName(chess960))]),
            h('td', { class: { tooltip: seek.fen !== '' } }, [
                this.tooltip(seek, variant),
                this.mode(seek),
            ]),
        ])
    }

    private seekView(seek: Seek) {
        const variant = VARIANTS[seek.variant];
        return this.hide(seek) ? "" : variant.twoBoards ? seekViewBughouse(this, seek) : this.seekViewRegular(seek);
    }

    private onClickSeek(seek: Seek) {
        if (seek["user"] === this.username) {
            this.doSend({ type: "delete_seek", seekID: seek["seekID"], player: this.username });
        } else {
            if (this.anon && seek.day !== 0) {
                alert(_('You need an account to do that.'));
                return;
            }
            this.doSend({ type: "accept_seek", seekID: seek["seekID"], player: this.username });
        }
    }

    private colorIcon(color: string) {
        return h('i-side.icon', {
            class: {
                "icon-adjust": color === "r",
                "icon-white": color === "w",
                "icon-black": color === "b",
            }
        });
    }

    public challengeIcon(seek: Seek) {
        const swords = (seek["user"] === this.username) ? 'vs-swords.icon' : 'vs-swords.opp.icon';
        return (seek['target'] === '') ? null : h(swords, { attrs: { "data-icon": '"' } });
    }
    public seekTitle(seek: Seek) {
        return (seek['target'] === '') ? h('player-title', " " + seek["title"] + " ") : null;
    }
    private user(seek: Seek) {
        if (seek["target"] === '' || seek["target"] === this.username)
            return seek["user"];
        else
            return seek["target"];
    }
    private hide(seek: Seek) {
        return ((this.anon || this.title === 'BOT') && seek["rated"]) ||
            (this.anon && VARIANTS[seek.variant].twoBoards) ||
            (seek['target'] !== '' && this.username !== seek['user'] && this.username !== seek['target']);
    }
    public tooltip(seek: Seek, variant: Variant) {
        let tooltipImage;
        if (seek.fen) {
            tooltipImage = h('minigame.' + variant.boardFamily + '.' + variant.pieceFamily, [
                h('div.cg-wrap.' + variant.board.cg + '.minitooltip',
                    {
                        hook: {
                            insert: (vnode) => Chessground(vnode.elm as HTMLElement, {
                                coordinates: false,
                                fen: seek.fen,
                                dimensions: variant.board.dimensions,
                            })
                        }
                    }
                ),
            ]);
        } else {
            tooltipImage = '';
        }
        return h('span.tooltiptext', [tooltipImage]);
    }

    public mode(seek: Seek) {
        if (seek.fen)
            return _("Custom");
        else if (seek.rated)
            return _("Rated");
        else
            return _("Casual");
    }

    private streamView(stream: Stream) {
        const url = (stream.site === 'twitch') ? 'https://www.twitch.tv/' : 'https://www.youtube.com/channel/';
        const tail = (stream.site === 'youtube') ? '/live' : '';
        return h('a.stream', { attrs: { "href": url + stream.streamer + tail, "rel": "noopener nofollow", "target": "_blank" } }, [
            h('strong.text', { class: { "icon": true, "icon-mic": true } }, displayName(stream.username)),
            stream.title,
        ]);
    }

    private spotlightView(spotlight: Spotlight) {
        const variant = VARIANTS[spotlight.variant];
        const chess960 = spotlight.chess960;
        const dataIcon = variant.icon(chess960);
        const lang = languageSettings.value;
        const name = spotlight.names[lang] ?? spotlight.names['en'];

        return h('a.tour-spotlight', { attrs: { "href": "/tournament/" + spotlight.tid } }, [
            h('i.icon', { attrs: { "data-icon": dataIcon } }),
            h('span.content', [
                h('span.name', name),
                h('span.more', [
                    h('nb', ngettext('%1 player', '%1 players', spotlight.nbPlayers) + ' • '),
                    h('info-date', { attrs: { "timestamp": spotlight.startsAt } })
                ])
            ])
        ]);
    }

    renderEmptyTvGame() {
        patch(document.getElementById('tv-game') as HTMLElement, h('a#tv-game.empty'));
    }

    renderTvGame() {
        if (this.tvGame === undefined) return;

        const game = this.tvGame;
        const variant = VARIANTS[game.variant];

        const isMatatakDraft = variant.name.startsWith('matatak') && game.fen.includes(' CUT ');
        const pocketRoles = (variant.name.startsWith('matatak') && !isMatatakDraft) ? undefined : variant.pocket?.roles;
        const showPockets = isMatatakDraft || (!variant.name.startsWith('matatak') && !!variant.pocket);

        const elements = [
            h(`div#mainboard.${variant.boardFamily}.${variant.pieceFamily}.${variant.ui.boardMark}`, {
                class: { "with-pockets": showPockets },
                style: { "--ranks": (variant.pocket) ? String(variant.board.dimensions.height) : "undefined" },
                on: { click: () => window.location.assign('/' + game.gameId) }
            }, [
                h(`div.cg-wrap.${variant.board.cg}.mini`, {
                    hook: {
                        insert: vnode => {
                            const cg = Chessground(vnode.elm as HTMLElement, {
                                fen: game.fen,
                                lastMove: uci2LastMove(game.lastMove),
                                dimensions: variant.board.dimensions,
                                coordinates: false,
                                viewOnly: true,
                                addDimensionsCssVarsTo: document.body,
                                pocketRoles: pocketRoles,
                            });
                            this.tvGameChessground = cg;
                            this.tvGameId = game.gameId;
                        }
                    }
                }),
            ]),
            h('span.vstext', [
                h('div.player', [h('tv-user', [h('player-title', game.bt), ' ' + displayName(game.b) + ' ', h('rating', game.br)])]),
                h('div.player', [h('tv-user', [h('player-title', game.wt), ' ' + displayName(game.w) + ' ', h('rating', game.wr)])]),
            ]),
        ];

        patch(document.getElementById('tv-game') as HTMLElement, h('a#tv-game', elements));

        boardSettings.assetURL = this.assetURL;
        boardSettings.updateBoardAndPieceStyles();
    }

    renderAutoPairingActions(autoPairingIsOn: boolean) {
        const eRange = document.querySelector('div.auto-rating-range') as Element;
        const eTimeControls = document.querySelector('div.timecontrols') as Element;
        const eVariants = document.querySelector('div.variants') as Element;
        // Page /jouer : pas de bloc d'appariement automatique (ancien salon pychess)
        if (!eRange || !eTimeControls || !eVariants) return;
        if (autoPairingIsOn) {
            if (this.autoPairingActions) {
                this.autoPairingActions = patch(this.autoPairingActions,
                    h('div.auto-pairing-actions', [
                        h('span.standingby', _('Standing by for auto pairing...')),
                        h('button.cancel', { on: { click: () => this.autoPairingCancel() } }, [h('div.icon.icon-ban', _('CANCEL'))]),
                    ])
                );
            }
            eRange.classList.toggle("disabled", true);
            eTimeControls.classList.toggle("disabled", true);
            eVariants.classList.toggle("disabled", true);
        } else {
            if (this.autoPairingActions) {
                this.autoPairingActions = patch(this.autoPairingActions,
                    h('div.auto-pairing-actions', [
                        h('button.selectall', { on: { click: () => this.autoPairingSelectAll() } }, [h('div.icon.icon-check', _('SELECT ALL'))]),
                        h('button.reset', { on: { click: () => this.autoPairingReset() } }, [h('div.icon.icon-trash-o', _('CLEAR ALL'))]),
                        h('button.submit', { on: { click: () => this.autoPairingSubmit() } }, [h('div.icon.icon-check', _('SUBMIT'))]),
                    ])
                );
            }
            eRange.classList.toggle("disabled", false);
            eTimeControls.classList.toggle("disabled", false);
            eVariants.classList.toggle("disabled", false);
        }
    }

    renderAutoPairingTable() {
        const variantList: VNode[] = [];
        enabledVariants.forEach(v => {
            const variant = VARIANTS[v];
            let variantName = variant.name;
            let checked = localStorage[`va_${variantName}`] ?? "false";
            if (variantName.startsWith('matatak') && !variant.twoBoards && !(contestVariants.includes(variantName))) {
                variantList.push(h('label', [h('input', { props: { name: `va_${variantName}`, type: "checkbox" }, attrs: { checked: checked === "true" } }), variantName]));
                if (variant.chess960) {
                    variantName = variantName + '960';
                    checked = localStorage[`va_${variantName}`] ?? "false";
                    variantList.push(h('label', [h('input', { props: { name: `va_${variantName}`, type: "checkbox" }, attrs: { checked: checked === "true" } }), variantName]));
                }
            }
        })
        patch(document.querySelector('div.variants') as Element, h('div.variants', variantList));

        const tcList: VNode[] = [];
        autoPairingTCs.forEach(v => {
            const tcName = timeControlStr(v[0], v[1], v[2]);
            const checked = localStorage[`tc_${tcName}`] ?? "false";
            tcList.push(h('label', [h('input', { props: { name: `tc_${tcName}`, type: "checkbox" }, attrs: { checked: checked === "true" } }), tcName]));
        })

        patch(document.querySelector('div.timecontrols') as Element, h('div.timecontrols', tcList));

        const aRatingMin = localStorage.auto_rating_min ?? -1000;
        const aRatingMax = localStorage.auto_rating_max ?? 1000;
        const aRatingRange = [
            _('Rating range'),
            h('div.rating-range', [
                h('input#auto-rating-min.slider', {
                    props: { name: "rating-min", type: "range", min: -1000, max: 0, step: 50, value: aRatingMin },
                    on: { input: e => this.setAutoRatingMin(parseInt((e.target as HTMLInputElement).value)) },
                    hook: { insert: vnode => this.setAutoRatingMin(parseInt((vnode.elm as HTMLInputElement).value)) },
                }),
                h('div.auto-rating-min', '-1000'),
                h('span', '/'),
                h('div.auto-rating-max', '+1000'),
                h('input#auto-rating-max.slider', {
                    props: { name: "rating-max", type: "range", min: 0, max: 1000, step: 50, value: aRatingMax },
                    on: { input: e => this.setAutoRatingMax(parseInt((e.target as HTMLInputElement).value)) },
                    hook: { insert: vnode => this.setAutoRatingMax(parseInt((vnode.elm as HTMLInputElement).value)) },
                }),
            ]),
        ];

        patch(document.querySelector('div.auto-rating-range') as Element, h('div.auto-rating-range', aRatingRange));
    }

    onMessage(evt: MessageEvent) {
        // console.log("<+++ lobby onMessage():", evt.data);
        if (evt.data === '/n') return;
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
            case "get_seeks":
                this.onMsgGetSeeks(msg);
                break;
            case "classee_attente":
                this.onMsgClassee(true);
                break;
            case "classee_annulee":
                this.onMsgClassee(false);
                break;
            case "classee_defi":
            case "classee_defi_envoye":
            case "classee_defi_fin":
                this.onMsgDefi(msg);
                break;
            case "new_game":
                this.onMsgNewGame(msg);
                break;
            case "game_in_progress":
                this.onMsgGameInProgress(msg);
                break;
            case "lobby_user_connected":
                this.onMsgUserConnected(msg);
                break;
            case "lobbychat":
                this.onMsgChat(msg);
                break;
            case "fullchat":
                this.onMsgFullChat(msg);
                break;
            case "ping":
                this.onMsgPing(msg);
                break;
            case "tv_game":
                this.onMsgTvGame(msg);
                break;
            case "board":
                this.onMsgBoard(msg);
                break;
            case "g_cnt":
                this.onMsgGameCounter(msg);
                break;
            case "u_cnt":
                this.onMsgUserCounter(msg);
                break;
            case "ap_cnt":
                this.onMsgAutoPairingCounter(msg);
                break;
            case "streams":
                this.onMsgStreams(msg);
                break;
            case "spotlights":
                this.onMsgSpotlights(msg);
                break;
            case "invite_created":
                this.onMsgInviteCreated(msg);
                break;
            case "bot_challenge_created":
                this.onMsgBOTChallengeCreated(msg);
                break;
            case "host_created":
                this.onMsgHostCreated(msg);
                break;
            case "auto_pairing_on":
                this.onMsgAutoPairingOn();
                break;
            case "auto_pairing_off":
                this.onMsgAutoPairingOff();
                break;
            case "shutdown":
                this.onMsgShutdown(msg);
                break;
            case "error":
                this.onMsgError(msg);
                break;
            case "logout":
                this.doSend({ type: "logout" });
                break;
        }
    }

    private onMsgBOTChallengeCreated(msg: MsgInviteCreated) {
        const gameURL = '/' + msg.gameId;
        const evtSource = new EventSource("/api/invites/" + msg.gameId);
        evtSource.onmessage = function (event) {
            const message = JSON.parse(event.data);
            // console.log("event from SSE", msg.gameId, message)
            if (message.gameId === msg.gameId) {
                window.location.assign(gameURL);
            }
        }
    }

    private onMsgInviteCreated(msg: MsgInviteCreated) {
        window.location.assign('/invite/' + msg.gameId);
    }

    private onMsgHostCreated(msg: MsgHostCreated) {
        window.location.assign('/invite/' + msg.gameId);
    }

    private onMsgAutoPairingOn() {
        if (!this.anon) this.renderAutoPairingActions(true);
    }

    private onMsgAutoPairingOff() {
        if (!this.anon) this.renderAutoPairingActions(false);
    }

    private onMsgGetSeeks(msg: MsgGetSeeks) {
        this.seeks = msg.seeks;
        // console.log("!!!! got get_seeks msg:", msg);

        const oldSeeks = document.querySelector('.seek-container table.seeks') as Element;
        if (oldSeeks) {
            oldSeeks.innerHTML = "";
            patch(oldSeeks, h('table.seeks', this.renderSeeks(msg.seeks.filter(seek => seek.day === 0))));
        }
    }

    private onMsgClassee(enAttente: boolean) {
        window.clearInterval(this.classeeMinuteur);
        this.classeeDebut = enAttente ? Date.now() : 0;
        // Le temps d'attente s'affiche à la seconde près
        if (enAttente) this.classeeMinuteur = window.setInterval(() => this.majJouer(), 1000);
        this.majJouer();
    }

    private onMsgNewGame(msg: MsgNewGame) {
        window.location.assign('/' + msg.gameId);
    }

    private onMsgGameInProgress(msg: MsgGameInProgress) {
        // Une partie pas encore commencée est annulée par le serveur : ici, elle a vraiment commencé.
        const response = confirm("Vous avez une partie en cours.\n\nOK : la reprendre.\nAnnuler : rester ici (pour en lancer une nouvelle, abandonnez-la d'abord).");
        if (response) window.location.assign('/' + msg.gameId);
    }

    private onMsgUserConnected(msg: MsgUserConnected) {
        if (this.username != msg.username) {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function (registrations) {
                    for (let registration of registrations) {
                        registration.unregister();
                    }
                    window.location.reload();
                });
            } else {
                window.location.reload();
            }
        } else {
            this.username = msg.username;
        }
    }

    private onMsgChat(msg: MsgChat) {
        if (document.getElementById('lobbychat')) {
            chatMessage(msg.user, msg.message, "lobbychat", msg.time);
        }
    }

    private onMsgFullChat(msg: MsgFullChat) {
        const messagesEl = document.getElementById('messages');
        if (messagesEl) {
            // To prevent multiplication of messages we have to remove old messages div first
            patch(messagesEl as HTMLElement, h('div#messages-clear'));
            // then create a new one
            patch(document.getElementById('messages-clear') as HTMLElement, h('div#messages'));
            // console.log("NEW FULL MESSAGES");
            msg.lines.forEach(line => chatMessage(line.user, line.message, "lobbychat", line.time));
        }
    }

    private onMsgPing(msg: MsgPing) {
        this.doSend({ type: "pong", timestamp: msg.timestamp });
    }

    private onMsgError(msg: MsgError) {
        alert(msg.message);
    }

    private onMsgShutdown(msg: MsgShutdown) {
        alert(msg.message);
    }

    private onMsgGameCounter(msg: MsgCounter) {
        const gameCount = document.getElementById('g_cnt');
        if (gameCount) patch(gameCount as HTMLElement, h('counter#g_cnt', ngettext('%1 game in play', '%1 games in play', msg.cnt)));
    }

    private onMsgUserCounter(msg: MsgCounter) {
        const userCount = document.getElementById('u_cnt');
        if (userCount) patch(userCount as HTMLElement, h('counter#u_cnt', ngettext('%1 player', '%1 players', msg.cnt)));
    }

    private onMsgAutoPairingCounter(msg: MsgCounter) {
        const gameCount = document.getElementById('ap_cnt');
        if (gameCount) patch(gameCount as HTMLElement, h('counter#ap_cnt', ngettext('%1 auto pairing', '%1 auto pairings', msg.cnt)));
    }

    private onMsgStreams(msg: MsgStreams) {
        if (this.streams) {
            this.streams = patch(this.streams, h('div#streams', msg.items.map(stream => this.streamView(stream))));
        }
    }

    private onMsgSpotlights(msg: MsgSpotlights) {
        if (this.spotlights) {
            this.spotlights = patch(this.spotlights, h('div#spotlights', msg.items.map(spotlight => this.spotlightView(spotlight))));
        }
    }

    private onMsgTvGame(msg: TvGame) {
        this.tvGame = msg;
        if (!document.getElementById('tv-game')) return; // pas d'encart TV sur /jouer
        this.renderEmptyTvGame();
        this.renderTvGame();
    }

    private onMsgBoard = (msg: MsgBoard) => {
        if (this.tvGameChessground === undefined || this.tvGameId !== msg.gameId) {
            return;
        };

        this.tvGameChessground.set({
            fen: msg.fen,
            turnColor: msg.fen.split(" ")[1] === "w" ? "white" : "black",
            check: msg.check,
            lastMove: uci2LastMove(msg.lastMove),
        });
    }
}

function seekHeader() {
    return h('thead', [
        h('tr', [
            h('th', [h('div#santa')]),
            h('th', _('Player')),
            h('th', _('Rating')),
            h('th', _('Time')),
            h('th', _('Variant')),
            h('th', _('Mode'))
        ])
    ]);
}

function runSeeks(vnode: VNode, model: PyChessModel) {
    const el = vnode.elm as HTMLElement;
    new LobbyController(el, model);
    // console.log("lobbyView() -> runSeeks()", el, model, ctrl);
}

export function lobbyView(model: PyChessModel): VNode[] {
    const puzzle = JSON.parse(model.puzzle);

    const username = model.username;
    const anonUser = model["anon"] === 'True';
    const corrGames = JSON.parse(model.corrGames).sort(compareGames(username));
    const gpCounter = corrGames.length;

    const myTurnGameCounter = (sum: number, game: Game) => sum + ((game.tp === username) ? 1 : 0);
    const count = corrGames.reduce(myTurnGameCounter, 0);

    const variant = VARIANTS[puzzle.variant];
    const turnColor = puzzle.fen.split(" ")[1] === "w" ? "white" : "black";
    const first = _(variant.colors.first);
    const second = _(variant.colors.second);

    const dailyPuzzle = [
        h('span.vstext', [
            h('span.text', _('Puzzle of the day')),
            h('span.text', _('%1 to play', (turnColor === 'white') ? first : second)),
        ]),
        h(`div#mainboard.${variant.boardFamily}.${variant.pieceFamily}.${variant.ui.boardMark}`, {
            class: { "with-pockets": !!variant.pocket },
            style: { "--ranks": (variant.pocket) ? String(variant.board.dimensions.height) : "undefined" },
        }, [
            h(`div.cg-wrap.${variant.board.cg}.mini`, {
                hook: {
                    insert: vnode => {
                        Chessground(vnode.elm as HTMLElement, {
                            orientation: variant.name === 'racingkings' ? 'white' : turnColor,
                            fen: puzzle.fen,
                            dimensions: variant.board.dimensions,
                            coordinates: false,
                            viewOnly: true,
                            addDimensionsCssVarsTo: document.body,
                            pocketRoles: variant.pocket?.roles,
                        });
                    }
                }
            }),
        ]),
    ];

    let tabs = [];
    tabs.push(h('span', { attrs: { role: 'tab', 'aria-selected': false, 'aria-controls': 'panel-1', id: 'tab-1', tabindex: '-1' } }, _('Lobby')));

    if (!anonUser) {
        tabs.push(h('span', { attrs: { role: 'tab', 'aria-selected': false, 'aria-controls': 'panel-4', id: 'tab-4', tabindex: '-1' } }, _('Auto pairing')))
    }

    let containers = [];
    containers.push(h('div', { attrs: { role: 'tablist', 'aria-label': 'Seek Tabs' } }, tabs));
    containers.push(
        h('div.seek-container', { attrs: { id: 'panel-1', role: 'tabpanel', tabindex: '-1', 'aria-labelledby': 'tab-1' } }, [
            h('div.seeks-table', [
                h('div.seeks-wrapper', h('table.seeks', { hook: { insert: vnode => runSeeks(vnode, model) } })),
            ])
        ])
    );

    if (!anonUser) {
        containers.push(
            h('div.auto-container', { attrs: { id: 'panel-4', role: 'tabpanel', tabindex: '-1', 'aria-labelledby': 'tab-4' } }, [
                h('div.seeks-table', [h('div.seeks-wrapper', [h('div.auto-pairing', [
                    h('div.auto-pairing-actions'),
                    h('div.auto-rating-range'),
                    h('div.timecontrols'),
                    h('div.variants'),
                ])])])
            ])
        )
    }

    if (model.view === 'jouer') {
        return [
            h('div.jouer-page'), // remplie par LobbyController.renderJouer()
            h('div.seekbuttons'),
            h('div.seekdialog', { hook: { insert: vnode => runSeeks(vnode, model) } }),
        ];
    }

    return [
        h('aside.sidebar-first', [
            h('div#streams'),
            h('div#lobbychat')
        ]),
        h('div.seeks', containers),
        h('aside.sidebar-second', [
            h('div.seekbuttons'),
            h('div.lobby-count', [
                h('a', { attrs: { href: '/players' } }, [h('counter#u_cnt')]),
                h('a', { attrs: { href: '/games' } }, [h('counter#g_cnt')]),
                h('counter#ap_cnt'),
            ]),
            h('div.seekdialog'),
        ]),
        h('under-left', [
            h('div.internalLinks', [
                h('a.reflist', { attrs: { href: 'https://discord.gg/ctGQa2WJjh', rel: "noopener", target: "_blank" } }, 'Discord'),
                h('a.reflist', { attrs: { href: 'https://github.com/Hugosabb/matatak', rel: "noopener", target: "_blank" } }, 'Github'),
                h('a.reflist', { attrs: { href: 'https://www.youtube.com/@matatakgame', rel: "noopener", target: "_blank" } }, 'YouTube'),
                h('a.reflist', { attrs: { href: 'https://www.instagram.com/playmatatak/', rel: "noopener", target: "_blank" } }, _("Instagram")),
            ]),
            h('div.internalLinks', [
                h('span.reflist', 'MATATAK © Synfaunia'),
                h('a.reflist', { attrs: { href: 'https://github.com/gbtami', rel: "noopener", target: "_blank" } }, 'Thanks to gbtami')
            ])
        ]),
        h('div.tv', [h('a#tv-game', { attrs: { href: '/tv' } })]),
    ];
}
