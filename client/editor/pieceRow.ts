import { h, VNode } from "snabbdom";

import * as cg from 'chessgroundx/types';

import { patch } from '@/document';
import { EditorController } from './editorCtrl';

// Bac des Personnages de l'éditeur : un camp à la fois (Blancs / Noirs), plus une gomme.
// Toucher une carte la sélectionne, puis chaque case touchée du plateau la reçoit (editorCtrl
// poserSurCase) : sur téléphone, glisser-déposer se battait avec le défilement de la page.
// À la souris, on peut aussi glisser une carte sur le plateau, comme avant.

export type Selection = { role: cg.Role, color: cg.Color } | 'gomme' | null;

function memeCarte(a: Selection, role: cg.Role, color: cg.Color): boolean {
    return a !== null && a !== 'gomme' && a.role === role && a.color === color;
}

// À la souris seulement, et quand elle bouge vraiment : un simple clic sélectionne la carte. Au toucher,
// le navigateur simule un clic de souris après le doigt : lancer le glisser à ce moment avalait le clic.
function glisser(ctrl: EditorController, role: cg.Role, color: cg.Color, e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const [x0, y0] = [e.clientX, e.clientY];
    const bouge = (m: PointerEvent) => {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
        fin();
        ctrl.chessground.dragNewPiece({ color, role, promoted: false }, false, m as unknown as cg.MouchEvent);
    };
    const fin = () => {
        document.removeEventListener('pointermove', bouge);
        document.removeEventListener('pointerup', fin);
    };
    document.addEventListener('pointermove', bouge);
    document.addEventListener('pointerup', fin);
}

// Au doigt, on agit au lever (pointerup) : un gestionnaire hérité annule le clic qui suit le toucher.
// Une bande qu'on fait défiler n'envoie pas de pointerup (pointercancel) : pas de sélection par erreur.
// Le clic reste pour la souris et le clavier.
function toucher(action: () => void) {
    return {
        pointerup: (e: PointerEvent) => { if (e.pointerType !== 'mouse') action(); },
        click: (e: MouseEvent) => { if (!['touch', 'pen'].includes((e as PointerEvent).pointerType)) action(); },
    };
}

function bacView(ctrl: EditorController): VNode {
    const couleur = ctrl.bacCouleur;
    const sel = ctrl.selection;
    const roles = ctrl.variant.pieceRow[couleur] as cg.Role[];
    const camp = (c: cg.Color, nom: string) =>
        h('button.camp', {
            class: { on: couleur === c },
            attrs: { type: 'button', 'aria-pressed': String(couleur === c) },
            on: toucher(() => { ctrl.bacCouleur = c; majBac(ctrl); }),
        }, [h(`i.${c}`), nom]);

    let aide = 'Touchez un Personnage, puis les cases du plateau.';
    if (sel === 'gomme') aide = 'Touchez les Personnages à retirer.';
    else if (sel !== null) aide = 'Touchez les cases où le poser. Touchez-le encore pour le reposer.';

    return h('div#ed-bac', [
        h('div.ed-camps', { attrs: { role: 'group', 'aria-label': 'Camp' } }, [
            camp('white', 'Blancs'),
            camp('black', 'Noirs'),
            h('button.gomme', {
                class: { on: sel === 'gomme' },
                attrs: { type: 'button', 'aria-pressed': String(sel === 'gomme'), title: 'Gomme' },
                on: toucher(() => ctrl.choisir(sel === 'gomme' ? null : 'gomme')),
            }, [
                h('svg', { attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' } }, [
                    h('path', { attrs: { d: 'M7 21h10M3.5 14.5l8-8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 19H7l-3.5-3.5a1 1 0 0 1 0-1z' } }),
                ]),
                h('span', 'Gomme'),
            ]),
        ]),
        h(`div.ed-cartes.${ctrl.variant.pieceFamily}`, roles.map(role =>
            h('button.ed-carte', {
                key: couleur + role,
                class: { on: memeCarte(sel, role, couleur) },
                attrs: { type: 'button', 'aria-pressed': String(memeCarte(sel, role, couleur)), 'aria-label': `Personnage ${couleur === 'white' ? 'blanc' : 'noir'}` },
                on: {
                    pointerdown: (e: PointerEvent) => glisser(ctrl, role, couleur, e),
                    ...toucher(() => ctrl.choisir(memeCarte(sel, role, couleur) ? null : { role, color: couleur })),
                },
            }, [h(`piece.${role}.${couleur}`)])
        )),
        h('p.ed-aide', { attrs: { 'aria-live': 'polite' } }, aide),
    ]);
}

export function initPieceRow(ctrl: EditorController, el: VNode | HTMLElement): void {
    ctrl.vbac = patch(el, bacView(ctrl));
}

export function majBac(ctrl: EditorController): void {
    if (ctrl.vbac) ctrl.vbac = patch(ctrl.vbac, bacView(ctrl));
}
