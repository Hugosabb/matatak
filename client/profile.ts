import { h, VNode } from 'snabbdom';

import { Chessground } from 'chessgroundx';
import * as cg from "chessgroundx/types";

import { languageSettings } from './i18n';
import { getLastMoveFen, VARIANTS } from './variants';
import { patch } from './document';
import { renderTimeago } from './datetime';
import { boardSettings } from './boardSettings';
import { timeControlStr } from './view';
import { PyChessModel } from "./types";
import { Ceval } from "./messages";
import { result } from './result';
import { roiDuNiveau } from './rois';

export interface Game {
    _id: string; // mongodb document id
    z: number; // chess960 (0/1)
    v: string; // variant name
    f: cg.FEN; // FEN 
    fp: cg.FEN; // FEN partner/second board B in case of bughouse

    lm: string; // last move
    lmB: string; // last move

    b: number; // TC base
    i: number; // TC increment
    bp: number; // TC byoyomi period

    y: number; // casual/rated/imported/correspondence (0/1/2/3)
    c: boolean; // correspondence game
    d: string; // datetime

    tid?: string; // tournament id
    tn?: string; // tournament name

    wb?: boolean; // white berserk
    bb?: boolean; // black berserk

    us: string[]; // users (wplayer name, bplayer name) or in case of bughouse: board A wplayer name, board A bplayer name, board B wplayer name, board B bplayer name
    wt: string; // white title
    bt: string; // black title

    wtB: string; // white title board B in case of bughouse
    btB: string; // black title board B in case of bughouse

    x: number; // Fairy level
    p0: Player; // white performance rating (rating, diff)
    p1: Player; // black performance rating (rating, diff)
    s: number; // game status range(-2, 14) as CREATED, STARTED, ABORTED, MATE, ... see in const.py
    r: string; // game result string (1-0, 0-1, 1/2-1/2, *)
    m: string[]; // moves in compressed format as they are stored in mongo. Only used for count of moves here
    a: Ceval[]; // analysis

    initialFen: string;
}

interface Player {
    e: string;
    d: number;
}

// Une partie = une carte : petit plateau, adversaire, Victoire / Défaite / Nul, Mini ou 8×8, cadence, date
// (page refaite le 03/11/2026, au style Matatak)
function renderGames(model: PyChessModel, games: Game[]) {
    return games.map(game => {
        const variant = VARIANTS[game.v];
        const tc = timeControlStr(game["b"], game["i"], game["bp"], game["c"] === true ? game["b"] : 0);
        const [lastMove, fen] = getLastMoveFen(variant.name, game.lm, game.f);
        const moi = game["us"][1] === model["profileid"] ? 1 : 0;
        const adv = 1 - moi;
        const titreAdv = game[adv === 0 ? "wt" : "bt"];
        // L'ordinateur du Solo : le Roi de son palier ; un adversaire d'entraînement classé (LIA, partie
        // classée) s'affiche comme un joueur
        const adversaire = titreAdv === 'LIA' && game["y"] !== 1
            ? `${roiDuNiveau(game["x"])} · Niveau ${game["x"]}`
            : game["us"][adv];
        const gagne = isWinClass(model, game);
        const issue = game["s"] === 0 ? ['annulee', 'Annulée']
            : game["r"] === '1/2-1/2' ? ['nul', 'Nul']
            : ['1-0', '0-1'].includes(game["r"]) ? (gagne ? ['victoire', 'Victoire'] : ['defaite', 'Défaite'])
            : ['encours', game["r"] === '*' ? 'En cours' : result(variant, game["s"], game["r"])];
        const perf = game[moi === 0 ? "p0" : "p1"];
        return h('a.partie', { attrs: { href: '/' + game["_id"] } }, [
            h(`selection.${variant.boardFamily}.${variant.pieceFamily}.${variant.ui.boardMark}.partie-plateau`, [
                h(`div.cg-wrap.${variant.board.cg}.mini`, {
                    hook: {
                        insert: vnode => Chessground(vnode.elm as HTMLElement, {
                            coordinates: false,
                            viewOnly: true,
                            fen: fen,
                            lastMove: lastMove,
                            dimensions: variant.board.dimensions,
                            pocketRoles: variant.pocket?.roles,
                            orientation: moi === 1 ? 'black' : 'white',
                        })
                    }
                }),
            ]),
            h('div.partie-infos', [
                h('div.partie-issue.' + issue[0], [
                    issue[1],
                    perf && game["y"] === 1 && perf["d"] ? h('span.partie-points', (perf["d"] > 0 ? ' +' : ' ') + perf["d"]) : '',
                ]),
                h('div.partie-adv', ['contre ', h('strong', adversaire)]),
                h('div.partie-meta', [
                    (variant.name === 'matatakmini' ? 'Mini' : '8×8') + ' · ' + tc + (game["y"] === 1 ? ' · Classée' : '') + ' · ',
                    h('info-date', { attrs: { timestamp: game["d"] } }),
                ]),
            ]),
        ]);
    });
}

function isWinClass(model: PyChessModel, game: Game): boolean {
    const variant = VARIANTS[game.v];
    if (variant.twoBoards){
        const team = game["us"][0] === model["profileid"] || game["us"][3] === model["profileid"]? 0: 1;
        return (game["r"] === '1-0' && team === 0) || (game["r"] === '0-1' && team === 1);
    } else {
        return (game["r"] === '1-0' && game["us"][0] === model["profileid"]) || (game["r"] === '0-1' && game["us"][1] === model["profileid"]);
    }
}

function loadGames(model: PyChessModel, page: number) {
    const lang = languageSettings.value;

    const xmlhttp = new XMLHttpRequest();
    let url = "/api/" + model["profileid"]
    if (model.level) {
        url = `${url}/loss?l=${lang}&x=8&p=`;
    } else if (model.variant) {
        url = `${url}/perf/${model.variant}?l=${lang}&p=`;
    } else if (model.rated === "1") {
        url = `${url}/rated?l=${lang}&p=`;
    } else if (model.rated === "2") {
        url = `${url}/import?l=${lang}&p=`;
    } else if (model.rated === "-2") {
        url = `${url}/playing?l=${lang}&p=`;
    } else if (model.rated === "-1") {
        url = `${url}/me?l=${lang}&p=`;
    } else {
        url = `${url}/all?l=${lang}&p=`;
    }

    xmlhttp.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
            const response = JSON.parse(this.responseText);

            // If empty JSON, exit the function
            if (!response.length) {
                return;
            }
            const oldVNode = document.getElementById('games');
            if (oldVNode instanceof Element)
                patch(oldVNode, h('div#games', renderGames(model, response)));
            renderTimeago();
        }
    };
    xmlhttp.open("GET", `${url}${page}`, true);
    xmlhttp.send();
}

function observeSentinel(vnode: VNode, model: PyChessModel) {
    const sentinel = vnode.elm as HTMLElement;
    let page = 0;
    const options = {root: null, rootMargin: '44px', threshold: 1.0};

    const intersectionObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.intersectionRatio > 0)) {
            loadGames(model, page);
            page += 1;
        }
    }, options);

    intersectionObserver.observe(sentinel);
}

export function profileView(model: PyChessModel) {
    boardSettings.assetURL = model.assetURL;
    boardSettings.updateBoardAndPieceStyles();

    const profileId = model["profileid"];
    const rated = model["rated"];

    const blockEl = document.getElementById('block') as HTMLElement;
    if (blockEl !== null) renderBlock('block', profileId);

    const unblockEl = document.getElementById('unblock') as HTMLElement;
    if (unblockEl !== null) renderUnblock('unblock', profileId);

    // Deux onglets seulement : toutes les parties, les classées
    const onglet = (texte: string, lien: string, actif: boolean) =>
        h('a.compte-onglet', { class: { actif }, attrs: { href: lien, 'aria-current': actif ? 'page' : 'false' } }, texte);
    return [
        h('nav.compte-onglets', [
            onglet('Parties', '/@/' + profileId, rated !== "1"),
            onglet('Classées', '/@/' + profileId + '/rated', rated === "1"),
        ]),
        h('div#games'),
        h('p.compte-vide', 'Aucune partie pour l\'instant.'),
        h('div#sentinel', { hook: { insert: (vnode) => observeSentinel(vnode, model) } }),
    ];
}

function renderBlock(id: string, profileId: string) {
    const el = document.getElementById(id) as HTMLElement;
    if (el !== null) {
        patch(el, h('a#block.compte-lien.discret', {
            attrs: { href: '/api/' + profileId + '/block' },
            on: { click: (e: Event) => postBlock(e, profileId, true) } },
            'Bloquer'
        ));
    }
}

function renderUnblock(id: string, profileId: string) {
    const el = document.getElementById(id) as HTMLElement;
    if (el !== null) {
        patch(el, h('a#unblock.compte-lien.discret', {
            attrs: { href: '/api/' + profileId + '/block' },
            on: { click: (e: Event) => postBlock(e, profileId, false) } },
            'Débloquer'
        ));
    }
}

function postBlock(e: Event, profileId: string, block: boolean) {
    e.preventDefault();
    const XHR = new XMLHttpRequest();
    const FD  = new FormData();
    FD.append('block', `${block}`);

    XHR.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
            const response = JSON.parse(this.responseText);
            if (response['error'] !== undefined) {
                console.log(response['error']);
            } else {
                if (block) {
                    renderUnblock('block', profileId);
                } else {
                    renderBlock('unblock', profileId);
                }
            }
        }
    }
    XHR.open("POST", `/api/${profileId}/block`, true);
    XHR.send(FD);
    return false;
}
