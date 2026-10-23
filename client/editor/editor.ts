import { h, VNode } from 'snabbdom';

import { _ } from '@/i18n';
import { PyChessModel } from "@/types";
import { twoBoarsVariants, selectVariant, VARIANTS, validVariant } from '@/variants';
import { EditorController } from './editorCtrl';

function runEditor(vnode: VNode, model: PyChessModel) {
    const el = vnode.elm as HTMLElement;
    new EditorController(el, model);
}

export function editorView(model: PyChessModel): VNode[] {

    const setVariant = (isInput: boolean) => {
        let e;
        e = document.getElementById('variant') as HTMLSelectElement;
        const variant = e.options[e.selectedIndex].value;
        if (isInput) window.location.assign('/editor/' + validVariant(variant));
    }

    const vVariant = model.variant || "matatak";
    const variant = VARIANTS[vVariant];

    // Ordinateur : cartes à gauche, plateau au centre à sa taille maximale (comme en partie), outils à
    // droite. Téléphone : plateau, puis le bac en une ligne qui défile, puis les outils.
    return [
        h('div.editor-app', [
            h('aside.ed-gauche', [h('div#ed-bac')]),
            h(`selection#mainboard.${variant.boardFamily}.${variant.pieceFamily}.${variant.ui.boardMark}`, [
                h('div.cg-wrap.' + variant.board.cg,
                    { hook: { insert: (vnode) => runEditor(vnode, model)},
                }),
            ]),
            h('aside.ed-droite', [
                h('div.ed-variante', [
                    h('label', { attrs: { for: "variant" } }, 'Plateau'),
                    selectVariant("variant", vVariant, () => setVariant(true), () => setVariant(false), twoBoarsVariants), /*todo:bughouse editor not implemented*/
                ]),
                h('div#editor-button-container'),
                h('div.ed-fen', [
                    h('label', { attrs: { for: 'fen' } }, 'Position (FEN)'),
                    h('input#fen'),
                ]),
            ]),
        ]),
    ];
}
