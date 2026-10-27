import { h, VNode } from "snabbdom";

import { _ } from './i18n';
import { colorIcon } from './chess';
import { aiLevel, gameType, renderRdiff } from './result';
import { timeago, } from './datetime';
import { alternateStartName, timeControlStr, displayName } from "./view";
import { PyChessModel } from "./types";
import { VARIANTS } from "./variants";
import { roiDuNiveau } from "./rois";
import { rivalDeLaPartie } from "./aventure/progression";


export function gameInfo(model: PyChessModel): VNode {
    // console.log("roundView model=", model);
    const variant = VARIANTS[model.variant];
    const chess960 = model.chess960 === 'True';
    const tc = timeControlStr(model["base"], model["inc"], model["byo"], model["corr"] === "True" ? model["base"] : 0);
    const altStartName = alternateStartName(variant, model.initialFen);
    const startFen = model.initialFen.replace(/\+/g, '.');
    const sections = [
        h('section', [
            // Une ligne : cadence, partie classée, date (le plateau et la variante se voient déjà)
            h('div.info-meta', [
                tc + (model["rated"] === '1' ? ' · ' + gameType(model["rated"]) : '') + ' · ',
                Number(model["status"]) >= 0 ? h('info-date', { attrs: { timestamp: model["date"] } }, timeago(model["date"])) : _("Playing right now"),
                altStartName ? h('div', altStartName) : '',
            ]),
            // Temps restant de chaque joueur au coup affiché : rempli par analysisClock.renderClocks
            h('div.player-data', [
                h('i-side.icon', { class: { [colorIcon(model.variant, variant.colors.first)]: true } }),
                h('player', playerInfo(model, 'w')),
                h('span.temps.temps-white'),
            ]),
            h('div.player-data', [
                h('i-side.icon', { class: { [colorIcon(model.variant, variant.colors.second)]: true } }),
                h('player', playerInfo(model, 'b')),
                h('span.temps.temps-black'),
            ]),
        ]),
    ];
    if (model["posnum"] >= 0) {
        sections.push(
            h('section', [
                h('div.posnum', [
                    _('Start position: '),
                    h('a', {
                        attrs: {
                            target: '_blank',
                            href: '/analysis/' + model["variant"] + '?fen=' + startFen
                        }
                    }, model["posnum"]),
                ])
            ])
        )
    }
    if (model["tournamentId"]) {
        sections.push(
            h('section', [
                h('div.tourney', [
                    h('a.icon.icon-trophy', { attrs: { href: '/tournament/' + model["tournamentId"] } }, model["tournamentname"])
                ])
            ])
        )
    }
    return h('div.game-info', sections);
}

function playerInfo(model: PyChessModel, color: string) {
    const username = model[color === "w" ? "wplayer" : "bplayer"];
    // En partie classée, l'adversaire d'entraînement (titre LIA) s'affiche comme un joueur
    const title = model["rated"] === '1' && model[color === "w" ? "wtitle" : "btitle"] === 'LIA' ? '' : model[color === "w" ? "wtitle" : "btitle"];
    const level = title === '' ? 0 : model.level;
    const rating = model[color === "w" ? "wrating" : "brating"];
    const rdiff = model[color === "w" ? "wrdiff" : "brdiff"];
    const berserk = model[color === "w" ? "wberserk" : "bberserk"];

    // L'ordinateur (Solo) : le Roi de son palier, comme dans les bandeaux de la partie
    if (title === 'LIA') {
        const niveau = Number(String(username).replace('Level ', '')) || level;
        // Aventure : le Roi rival de la partie, sans le niveau (caché)
        const rival = rivalDeLaPartie(model["gameId"]);
        return h('span.user-link.joueur-ia', rival ? [rival] : [roiDuNiveau(niveau), h('small', ` · Niveau ${niveau}`)]);
    }
    return h('a.user-link', { attrs: { href: '/@/' + username } }, [
        (title !== '') ? h('player-title', title + ' ') : '',
        displayName(username) + aiLevel(title, level) + ((!['BOT', 'LIA'].includes(title) && rating !== '1500?') ? (" (" + rating + ") ") : ''),
        model["status"] < 1 || model["rated"] !== '1' ? h('rdiff#' + color + 'rdiff') : renderRdiff(rdiff),
        (berserk === "True") ? h('icon.icon-berserk') : h('berserk#' + color + 'berserk'),
    ]);
}
