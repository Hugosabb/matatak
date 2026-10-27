import { h, VNode } from 'snabbdom';

import { _ } from './i18n';
import { VARIANTS } from './variants';
import { patch } from './document';
import { gameType } from './result';
import { copyTextToClipboard } from './clipboard';
import { timeControlStr } from './view';
import { PyChessModel } from './types';
import { sanitizeURL } from './url';
import { duoEchange } from './carteAnimee';

export function inviteView(model: PyChessModel): VNode[] {
    const gameId = model["gameId"];
    const variant = VARIANTS[model.variant];
    const chess960 = model.chess960 === 'True';
    const gameURL = '/invite/' + gameId;
    const gameURLPlayer1 = gameURL + '/player1';
    const gameURLPlayer2 = gameURL + '/player2';
    const seekEmpty = model["seekEmpty"];

    const evtSource = new EventSource("/api/invites/" + gameId);
    evtSource.onmessage = function(event) {
        const message = JSON.parse(event.data);
        if (message.gameId === gameId) {
            window.location.assign(sanitizeURL(gameURL));
        }
    }

    let title, formAction, buttonClass, buttonText;
    let player: string = window.location.pathname.split("/").pop()!;
    if (!player?.match(/player[1-2]/)) player = "";

    switch (model["inviter"]) {
        case "":
            title = seekEmpty ? _('Host a game for others') : _('Challenge to a game');
            formAction = '/invite/cancel/' + gameId;
            buttonClass = {red: true};
            buttonText = _('CANCEL');
            break;
        case "wait":
            title = _('Waiting for the other player');
            formAction = '/invite/cancel/' + gameId;
            buttonClass = {red: true};
            buttonText = _('CANCEL');
            break;
        case "occupied":
            title = _('Sorry, this seat is already occupied');
            formAction = '/invite/cancel/' + gameId;
            buttonClass = {red: true};
            buttonText = _('CANCEL');
            break;
        case "yourself":
            title = _('Sorry, you cannot play with yourself');
            formAction = '/invite/cancel/' + gameId;
            buttonClass = {red: true};
            buttonText = _('CANCEL');
            break;
        default:
            title = model["inviter"];
            formAction = '/invite/accept/' + gameId + (!!player ? "/" + player : "");
            buttonClass = {join: true};
            buttonText = _('JOIN THE GAME');
    }

    // Partie à 2 (cas MATATAK) : page refaite aux couleurs du site ; le cas « héberger pour deux
    // inconnus » (seekEmpty) garde l'ancien affichage pychess plus bas.
    if (!seekEmpty) return [pageInvitation(model, gameURL, formAction, title)];

    return [
        h('div.invite', [
            h('h1', { attrs: { align: 'center' } }, title),
            h('div.invitegame', [
                h('div.info0.games.icon', { attrs: { "data-icon": variant.icon(chess960) } }, [
                    h('div.info2', [
                        h('div', variant.displayName(chess960)),
                        h('div.tc', timeControlStr(model["base"], model["inc"], model["byo"])),
                        h('div', h('i', { class: {
                            // TODO Correct icon colour for different variants
                            "icon": !!player,
                            "icon-white": player === "player1",
                            "icon-black": player === "player2"
                        } })),
                    ]),
                    h('div.rated', gameType(model["rated"])),
                ]),
            ]),
            (model["inviter"] === "") ?
                ( (seekEmpty) ?
                    h('div.inviteinfo', [
                        h('div', _('To invite someone to play, give them this URL:')),
                        h('div', [
                            h('label', {attrs: {for: "invite-url-player1"}}, _(variant.colors.first)),
                            h('input#invite-url-player1', {attrs: {readonly: true, spellcheck: false, value: model["home"] + gameURLPlayer1}}),
                            h('button#paste-url-player1', { class: { "paste-url": true }, on: { click: () => {
                                copyTextToClipboard(model["home"] + gameURLPlayer1);
                                patch(document.getElementById('paste-icon-player1') as HTMLElement,
                                    h('i#paste-icon-player1', {props: {title: _('Copy URL')}, class: {"icon": true, "icon-check": true} }));
                            } } }, [
                                h('i#paste-icon-player1', {props: {title: _('Copy URL')}, class: {"icon": true, "icon-clipboard": true} })])
                        ]),
                        h('div', [
                            h('label', {attrs: {for: "invite-url-player2"}}, _(variant.colors.second)),
                            h('input#invite-url-player2', {attrs: {readonly: true, spellcheck: false, value: model["home"] + gameURLPlayer2}}),
                            h('button#paste-url-player2', { class: { "paste-url": true }, on: { click: () => {
                                copyTextToClipboard(model["home"] + gameURLPlayer2);
                                patch(document.getElementById('paste-icon-player2') as HTMLElement,
                                    h('i#paste-icon-player2', {props: {title: _('Copy URL')}, class: {"icon": true, "icon-check": true} }));
                            } } }, [
                                h('i#paste-icon-player2', {props: {title: _('Copy URL')}, class: {"icon": true, "icon-clipboard": true} })])
                        ]),
                        h('div', _('The first two people to come to this URL will play with each other.')),
                    ]) :
                    h('div.inviteinfo', [
                        h('div', _('To invite someone to play, give them this URL:')),
                        h('input#invite-url', {attrs: {readonly: true, spellcheck: false, value: model["home"] + gameURL}}),
                        h('button#paste-url', { class: { "paste-url": true }, on: { click: () => {
                            copyTextToClipboard(model["home"] + gameURL);
                            patch(document.getElementById('paste-icon') as HTMLElement,
                                h('i#paste-icon', {props: {title: _('Copy URL')}, class: {"icon": true, "icon-check": true} }));
                        } } }, [
                            h('i#paste-icon', {props: {title: _('Copy URL')}, class: {"icon": true, "icon-clipboard": true} })]),
                        h('div', _('The first person to come to this URL will play with you.')),
                    ]) ) :
                h('div'),
            // TODO Wait actually should have cancel button but the server doesn't support it at the moment
            model["inviter"] !== "wait" && model["inviter"] !== "occupied" && model["inviter"] !== "yourself" ?
                h('form', {props: {method: "post", action: formAction}, class: {invite: true}}, [
                    h('button', {class: buttonClass}, buttonText),
                ]) :
                h('div'),
        ]),
    ];
}

function cadence(model: PyChessModel): string {
    const base = Number(model["base"]), inc = Number(model["inc"]);
    return base === 0 && inc === 0 ? 'Sans limite' : `${base} min${inc ? ` +${inc}` : ''}`;
}

// Saison de l'équipe de départ de l'invité (champ « equipe » du formulaire, server/views/invite.py)
const SAISONS_EQUIPE: [string, string, string][] = [
    ['ete', 'AZAR', '01-azar.webp'], ['automne', 'SHANS', '02-shans.webp'],
    ['hiver', 'KARMA', '03-karma.webp'], ['printemps', 'MOJO', '04-mojo.webp'],
];

function choixEquipe(hote: string, saisonHote: string): VNode {
    const roiHote = SAISONS_EQUIPE.find(([s]) => s === saisonHote)?.[1];
    const choix = (valeur: string, id: string, contenu: VNode[]) => [
        h('input', { attrs: { type: 'radio', name: 'equipe', value: valeur, id, checked: valeur === '' } }),
        h('label.choix-eq', { attrs: { for: id } }, contenu),
    ];
    return h('div.invite-equipe', [
        h('div.etiq', 'Votre équipe'),
        h('div.choix-equipe', { attrs: { role: 'radiogroup', 'aria-label': 'Votre équipe' } }, [
            ...choix('', 'equipe-hasard', [h('span.hasard'), h('small', 'Hasard')]),
            ...SAISONS_EQUIPE.flatMap(([s, roi, image]) =>
                choix(s, `equipe-${s}`, [h('img', { attrs: { src: `/static/images/background/collection/sombre/${image}`, alt: '' } }), h('small', roi)])),
        ]),
        h('small.aide', roiHote ? `${hote} joue l'équipe de ${roiHote}.` : `${hote} joue une équipe au hasard.`),
    ]);
}

/** Invitation entre amis : « Invitez un ami » (lien à partager, attente) ou « X vous défie ! » (rejoindre). */
function pageInvitation(model: PyChessModel, gameURL: string, formAction: string, titreDefaut: string): VNode {
    const variant = VARIANTS[model.variant];
    const inviter = model["inviter"];
    const lien = model["home"] + gameURL;
    const resume = h('p.invite-partie', `${variant.displayName(false)} · ${cadence(model)}`);
    const duo = h('div.invite-cartes', { style: { '--carte': 'min(160px, 38vw)' } }, [duoEchange('11-frank.webp', '10-krak.webp')]);
    const annuler = h('form.invite-form', { props: { method: 'post', action: formAction } }, [
        h('button.invite-annuler', { attrs: { type: 'submit' } }, "Annuler l'invitation"),
    ]);

    if (inviter === '') {
        const peutPartager = typeof navigator.share === 'function';
        const partager = (ev: Event) => {
            const bouton = ev.currentTarget as HTMLElement;
            if (peutPartager) {
                navigator.share({ title: 'MATATAK', text: 'Je te défie à MATATAK !', url: lien }).catch(() => { /* partage annulé */ });
            } else {
                copyTextToClipboard(lien);
                bouton.textContent = 'Lien copié !';
                setTimeout(() => { bouton.textContent = 'Copier le lien'; }, 2500);
            }
        };
        return h('div.invite.mt-invite', [
            h('h1', 'Invitez un ami'),
            resume,
            duo,
            h('button.mt-btn.mt-btn-or.invite-partager', { attrs: { type: 'button' }, on: { click: partager } }, peutPartager ? 'Partager le lien' : 'Copier le lien'),
            h('input.invite-lien', { attrs: { readonly: true, spellcheck: false, value: lien, 'aria-label': "Lien de l'invitation" }, on: { focus: (e: Event) => (e.target as HTMLInputElement).select() } }),
            h('p.invite-attente', [h('span.pouls'), "En attente de votre ami : la partie commence dès qu'il ouvre le lien."]),
            annuler,
        ]);
    }

    if (['wait', 'occupied', 'yourself'].includes(inviter)) {
        return h('div.invite.mt-invite', [h('h1', titreDefaut), resume, inviter === 'wait' ? h('p.invite-attente', [h('span.pouls'), 'En attente…']) : '', annuler]);
    }

    // Côté invité : qui défie, puis un seul bouton
    const nom = inviter.split('#')[0];
    let reglesConnues = false;
    try { reglesConnues = ['fini', 'connu'].includes(localStorage.getItem('matatak_tutoriel') ?? ''); } catch { /* navigation privée */ }
    return h('div.invite.mt-invite', [
        h('h1', `${nom} vous défie !`),
        resume,
        duo,
        h('form.invite-form', { props: { method: 'post', action: formAction } }, [
            model.choixequipe ? choixEquipe(nom, model.choixequipe) : '',
            h('button.mt-btn.mt-btn-or', { attrs: { type: 'submit' } }, 'Rejoindre la partie'),
        ]),
        reglesConnues ? '' : h('a.invite-regles', { attrs: { href: '/tutorial/1', target: '_blank', rel: 'noopener' } }, 'Nouveau ? Les règles en 2 minutes'),
    ]);
}
