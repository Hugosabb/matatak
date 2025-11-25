import { h } from 'snabbdom';

import { aiLevel } from './result';
import { displayName } from './view';

export function player(id: string, title: string, name: string, rating: string, level: number) {
    return h('round-' + id, [
        h('div.player-data', [
            h('i-side#' + id + '.online.icon', { class: { "icon-online": false, "icon-offline": true } }),
            h('player', [
                h('a.user-link', { attrs: {href: '/@/' + name} }, [
                    (title !== '') ? h('player-title', title + ' ') : '',
                    displayName(name) + aiLevel(title, level),
                ]),
                h('rating', !['BOT', 'GHOST'].includes(title) ? rating : ''),
            ]),
        ]),
    ]);
}
