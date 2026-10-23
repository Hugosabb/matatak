import { h, VNode } from 'snabbdom';

import { WHITE, BLACK } from './chess';
import { AnalysisController } from './analysisCtrl';
import { patch } from './document';

export function renderClocks(ctrl: AnalysisController) {
    // Les pendules du plateau (pychess) restent cachées : le temps de chaque joueur au coup
    // affiché s'écrit à droite de son nom, dans le panneau de la partie (gameInfo).
    document.querySelectorAll<HTMLElement>('.anal-clock, #anal-clock-top, #anal-clock-bottom').forEach(e => e.style.display = 'none');
    // Partie sans pendule (Sans limite) : rien à montrer
    if (ctrl.base === 0 && ctrl.inc === 0) return;
    const clocks = ctrl.steps[ctrl.ply]?.clocks;
    const isWhiteTurn = ctrl.turnColor === "white";
    ([['white', WHITE, isWhiteTurn], ['black', BLACK, !isWhiteTurn]] as const).forEach(([couleur, index, active]) => {
        const el = document.querySelector(`.temps-${couleur}`);
        // Vider d'abord : patcher un élément du DOM ajoute les enfants sans retirer les anciens
        if (el) el.replaceChildren();
        if (el) patch(el, h(`span.temps.temps-${couleur}`, { class: { active } }, clocks ? clockContent(clocks[index]) : ''));
    });
}

function clockContent(time: number): Array<string | VNode> {
  if (!time && time !== 0) return ['-'];
  const date = new Date(time),
    millis = date.getUTCMilliseconds(),
    sep = ':',
    baseStr = pad2(date.getUTCMinutes()) + sep + pad2(date.getUTCSeconds());
  if (time >= 3600000) return [Math.floor(time / 3600000) + sep + baseStr];
  return time >= 60000 ? [baseStr] : [baseStr, h('tenths', '.' + Math.floor(millis / 100).toString())];
}

function pad2(num: number): string {
  return (num < 10 ? '0' : '') + num;
}
