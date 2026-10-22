import { h } from 'snabbdom';

import { aiLevel } from './result';
import { displayName } from './view';
import { roiDuNiveau } from './rois';

// Mode Solo : l'adversaire « Level N » devient le Roi de son palier
function niveauSolo(name: string, level: number): number {
    return level > 0 ? level : Number(name.replace(/\D/g, '')) || 1;
}

export function player(id: string, title: string, name: string, rating: string, level: number) {
    const isBotOrGhost = ['BOT', 'LIA'].includes(title);
    return h('round-' + id, [
        h('div.player-data', [
            h('i-side#' + id + '.online.icon', { class: { "icon-online": isBotOrGhost, "icon-offline": !isBotOrGhost } }),
            h('player', [
                // Adversaire du mode Solo (« Level N », titre LIA) : pas de profil, le Roi de son palier
                title === 'LIA'
                    ? h('span.user-link', [roiDuNiveau(niveauSolo(name, level)), h('player-title', `Niv. ${niveauSolo(name, level)}`)])
                    : h('a.user-link', { attrs: { href: '/@/' + name } }, [
                        (title !== '') ? h('player-title', title + ' ') : '',
                        displayName(name) + aiLevel(title, level),
                    ]),
                h('rating', (!isBotOrGhost && rating !== '1500?') ? rating : ''),
            ]),
        ]),
    ]);
}
