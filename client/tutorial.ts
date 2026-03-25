import { h, VNode } from "snabbdom";
import { _ } from './i18n';
import { TutorialController } from './tutorialCtrl';
import { VARIANTS } from './variants';
import { PyChessModel } from './types';
import { analysisTools } from './analysis';

function runTutorial(vnode: VNode, model: PyChessModel) {
    const el = vnode.elm as HTMLElement;
    const ctrl = new TutorialController(el, model);
    window['onFSFline'] = ctrl.onFSFline;
}

function leftSide(model: PyChessModel) {
    return h('div', [
        h('div.puzzle-meta', [
            h('div.infos'),
        ]),
        // We include these dummy elements so PuzzleController constructor doesn't crash
        h('div.puzzle-user', [
            h('div.rated-toggle'),
            h('div.rating'),
        ]),
        h('div.puzzle-info', [
            h('div.auto-next-toggle'),
        ]),
    ]);
}

export function tutorialView(model: PyChessModel): VNode[] {
    const variant = VARIANTS[model.variant];
    return [
        h('style', `
            .pocket-top, .pocket-bot {
                display: none;
            }
            #mainboard.pockets-visible ~ .pocket-top,
            #mainboard.pockets-visible ~ .pocket-bot {
                display: flex; 
            }
            .tutorial-info {
                padding: 10px 14px;
                overflow-wrap: break-word;
                word-wrap: break-word;
                background: var(--bg-color1);
                border-radius: 4px;
            }
            .tutorial-title {
                font-size: 1.2em;
                font-weight: bold;
                margin: 0 0 6px 0;
            }
            .tutorial-instruction {
                font-size: 1.1em;
                line-height: 1.5;
                margin: 0 0 10px 0;
            }
            .tutorial-progress {
                height: 5px;
                background: var(--bg-color2);
                border-radius: 3px;
                overflow: hidden;
                margin-bottom: 5px;
            }
            .tutorial-progress-bar {
                height: 100%;
                background: var(--good);
                border-radius: 3px;
                transition: width 0.3s ease;
            }
            .tutorial-step-label {
                font-size: 0.85em;
                opacity: 0.6;
            }
            .tutorial-success {
                text-align: center;
            }
            .tutorial-success-msg {
                color: var(--good);
                font-size: 1.1em;
                font-weight: bold;
                margin-bottom: 12px;
                overflow-wrap: break-word;
                word-wrap: break-word;
            }
            .tutorial-success a.button {
                display: inline-block;
                margin-top: 4px;
            }
            .tutorial-app .analysis-tools,
            .tutorial-app #move-controls,
            .tutorial-app .movelist-block,
            .tutorial-app #gauge,
            .tutorial-app .btn-controls {
                display: none !important;
            }
        `),
        h('div.analysis-app.tutorial-app', [
            h('aside.sidebar-first', leftSide(model)),
            h(`selection#mainboard.${variant.boardFamily}.${variant.pieceFamily}.${variant.ui.boardMark}`, [
                h('div.cg-wrap.' + variant.board.cg, { hook: { insert: (vnode) => runTutorial(vnode, model) } }),
            ]),
            h('div.pocket-top', [
                h('div.' + variant.pieceFamily + '.' + model["variant"], [
                    h('div.cg-wrap.pocket', [
                        h('div#pocket0'),
                    ]),
                ]),
            ]),
            h('div#gauge', { style: { display: 'none' } }),
            analysisTools(),
            h('div#move-controls'),
            h('div.pocket-bot', [
                h('div.' + variant.pieceFamily + '.' + model["variant"], [
                    h('div.cg-wrap.pocket', [
                        h('div#pocket1'),
                    ]),
                ]),
            ]),
            h('under-left#spectators'),
            h('under-board')
        ]),
    ];
}
