// Le Roi qui parle (bulle de l'Aventure et du tutoriel) : sa tête détourée dans un rond cerclé de la couleur
// de sa Saison, qui en dépasse par endroits, et ses mains (calques à part des PSD de l'artiste). Images :
// ../jeu/assets/site/images/background/rois/{roi}-{tete,main-gauche,main-droite}-{256,512}.webp (même cadre,
// superposées). Placement réglé par Hugo avec son outil (10/11/2026) : static/matatak-ui.css, .tete-roi.r-…

import { h, VNode } from 'snabbdom';

export type RoiQuiParle = 'AZAR' | 'SHANS' | 'KARMA' | 'MOJO';

const SAISON: Record<RoiQuiParle, string> = { AZAR: 'ete', SHANS: 'automne', KARMA: 'hiver', MOJO: 'printemps' };
// Mains à part ; « devant » = jamais coupée par le rond
const MAINS: Record<RoiQuiParle, [string, boolean][]> = {
    AZAR: [['main-gauche', true], ['main-droite', false]],
    SHANS: [],
    KARMA: [['main-droite', true]],
    MOJO: [['main-droite', false]],
};
const DOSSIER = '/static/images/background/rois/';

export function teteRoi(roi: RoiQuiParle, sel = 'span.tete-roi'): VNode {
    const r = roi.toLowerCase();
    const image = (partie: string, devant = false) => h(devant ? 'img.devant' : 'img', { attrs: {
        src: `${DOSSIER}${r}-${partie}-256.webp`,
        srcset: `${DOSSIER}${r}-${partie}-256.webp 1x, ${DOSSIER}${r}-${partie}-512.webp 2x`,
        alt: partie === 'tete' ? roi : '',
    } });
    return h(`${sel}.${SAISON[roi]}.r-${r}`, [image('tete'), ...MAINS[roi].map(([m, devant]) => image(m, devant))]);
}
