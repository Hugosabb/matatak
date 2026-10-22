import { h, VNode } from "snabbdom";

import { RoundController } from './roundCtrl';
import { gameInfo } from './gameInfo';
import { renderTimeago } from './datetime';
import { VARIANTS } from './variants';
import { PyChessModel } from "./types";

function runGround(vnode: VNode, model: PyChessModel) {
    const el = vnode.elm as HTMLElement;
    const ctrl = new RoundController(el, model);
    const cg = ctrl.chessground;
    window['cg'] = cg;
}

export function roundView(model: PyChessModel): VNode[] {
    const variant = VARIANTS[model.variant];
    // Cadence 0+0 hors correspondance : pas de pendule à afficher
    const sansLimite = Number(model.base) === 0 && Number(model.inc) === 0 && Number(model.byo) === 0 && model.corr !== 'True';

    renderTimeago();

    return [
        h('style', `
            .pocket-top, .pocket-bot {
                display: none;
            }
            #mainboard.pockets-visible ~ .pocket-top,
            #mainboard.pockets-visible ~ .pocket-bot {
                display: flex; 
            }
        `),
        // Écran du Draft (client/draft.ts), à la place du plateau tant que les équipes se composent
        h('div#draft-ecran'),
        h('aside.sidebar-first', [
            gameInfo(model),
            h('div#roundchat'),
        ]),
        h('div.round-app', [
            h(`selection#mainboard.${variant.boardFamily}.${variant.pieceFamily}.${variant.ui.boardMark}`, [
                h('div.cg-wrap.' + variant.board.cg, {
                    hook: {
                        insert: (vnode) => runGround(vnode, model)
                    },
                }),
            ]),
            h('div.material.material-top.' + variant.pieceFamily + '.disabled'),
            h('div.pocket-top', [
                h('div.' + variant.pieceFamily + '.' + model["variant"], [
                    h('div.cg-wrap.pocket', [
                        h('div#pocket0.pocketrow'),
                    ]),
                ]),
            ]),
            h('div.info-wrap0', [
                h('div.clock-wrap', { class: { 'sans-limite': sansLimite } }, [
                    h('div#clock0'),
                    h('div#more-time'),
                    h('div#berserk0'),
                ]),
                h('div#misc-info0'),
            ]),
            h('div#expiration-top'),
            h('round-player0#rplayer0'),
            h('div.movelist-block', [
                h('div.moves-toggle-wrap', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '5px' } }, [
                    h('label.switch', { attrs: { title: 'Toggle moves' } }, [
                        h('input#toggle-moves', { attrs: { type: 'checkbox', checked: false } }),
                        h('span.sw-slider'),
                    ]),
                ]),
                h('div#move-controls'),
                h('div#movelist'),
            ]),
            h('div#offer-dialog'),
            h('div#game-controls'),
            h('round-player1#rplayer1'),
            h('div#expiration-bottom'),
            h('div.info-wrap1', [
                h('div.clock-wrap', { class: { 'sans-limite': sansLimite } }, [
                    h('div#clock1'),
                    h('div#berserk1'),
                ]),
                h('div#misc-info1'),
            ]),
            h('div.pocket-bot', [
                h('div.' + variant.pieceFamily + '.' + model["variant"], [
                    h('div.cg-wrap.pocket', [
                        h('div#pocket1.pocketrow'),
                    ]),
                ]),
            ]),
            h('div.material.material-bottom.' + variant.pieceFamily + '.disabled'),
            h('div#barre-partie'),
        ]),
        h('under-left#spectators'),
        h('under-board', [
            h('div#janggi-setup-buttons'),
            h('div.ctable-container'),
            h('div.games-container'),
        ]),
    ];
}
