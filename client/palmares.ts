import { h, VNode } from 'snabbdom';

import { patch } from './document';
import { PyChessModel } from './types';

// Palmarès (server/palmares.py) : la semaine (points gagnés en jouant des parties classées, même
// perdues ; remise à zéro le lundi, couronne au premier) et les classements de tous les temps.

export interface LigneSemaine { u: string; p: number; n: number; v: number; }
interface LigneGenerale { u: string; r: number; prov: boolean; nb: number; }
export interface PalmaresInfos {
    semaine: string;
    fin: string;
    top: LigneSemaine[];
    joueurs: number;
    moi: (LigneSemaine & { rang: number }) | null;
    couronne: string | null;
    general: { matatak: LigneGenerale[], matatakmini: LigneGenerale[] };
}

type Onglet = 'semaine' | 'matatakmini' | 'matatak';

export function chargerPalmares(): Promise<PalmaresInfos> {
    return fetch('/api/palmares', { credentials: 'same-origin' }).then(r => r.json());
}

/** Couronne dorée du premier de la semaine passée. */
export function couronne(titre = 'Premier du palmarès la semaine dernière'): VNode {
    return h('svg.couronne', { attrs: { viewBox: '0 0 24 24', role: 'img', 'aria-label': titre } }, [
        h('title', titre),
        h('path', { attrs: { d: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z', fill: 'currentColor' } }),
    ]);
}

export function rangTexte(rang: number): string {
    return rang === 1 ? '1er' : `${rang}e`;
}

/** « dans 3 j 14 h » jusqu'à la remise à zéro du lundi. */
function avantRemise(fin: string): string {
    const ms = Math.max(0, new Date(fin).getTime() - Date.now());
    const heures = Math.floor(ms / 3600000);
    const jours = Math.floor(heures / 24);
    return jours > 0 ? `dans ${jours} j ${heures % 24} h` : heures > 0 ? `dans ${heures} h` : 'dans moins d\'une heure';
}

function nom(u: string, infos: PalmaresInfos, moi: string): VNode {
    return h('a.nom', { class: { moi: u === moi }, attrs: { href: '/@/' + u } }, [
        infos.couronne === u ? couronne() : '', u,
    ]);
}

function vueSemaine(infos: PalmaresInfos, moi: string): VNode[] {
    const lignes = infos.top.map((l, i) => h('li', { class: { moi: l.u === moi, podium: i < 3 } }, [
        h('span.rang', String(i + 1)),
        h('span.qui', [nom(l.u, infos, moi), h('small', `${l.n} partie${l.n > 1 ? 's' : ''} · ${l.v} victoire${l.v > 1 ? 's' : ''}`)]),
        h('span.points', [String(l.p), h('small', 'pts')]),
    ]));
    const moiHorsTop = infos.moi && !infos.top.some(l => l.u === moi);
    return [
        h('p.remise', `Remise à zéro lundi, ${avantRemise(infos.fin)}. Le premier porte la couronne toute la semaine suivante.`),
        infos.couronne ? h('p.porteur', [couronne(), h('span', [h('b', infos.couronne), ' porte la couronne : premier la semaine dernière.'])]) : '',
        infos.moi
            ? h('div.ma-place', [h('b', rangTexte(infos.moi.rang)), h('span', ` sur ${infos.joueurs} · ${infos.moi.p} points cette semaine`)])
            : '',
        lignes.length
            ? h('ol.liste', lignes)
            : h('div.vide', [
                h('p', "Personne n'a encore joué dans l'Arène cette semaine. À vous la couronne !"),
                h('a.mt-btn.mt-btn-or', { attrs: { href: '/jouer?classee=1' } }, "Jouer dans l'Arène"),
            ]),
        moiHorsTop ? h('p.ma-place-bas', `Vous : ${rangTexte(infos.moi!.rang)}, ${infos.moi!.p} points`) : '',
        h('details.bareme', [
            h('summary', 'Comment gagner des points ?'),
            h('ul', [
                h('li', [h('b', "Chaque partie de l'Arène rapporte"), ', même perdue : 10 points pour une défaite, 25 pour une nulle, 50 pour une victoire.']),
                h('li', [h('b', 'Battre plus fort que soi'), ' rapporte jusqu\'à deux fois plus (jusqu\'à ×2 avec 400 points d\'écart).']),
                h('li', [h('b', 'Plus votre classement est haut'), ', plus chaque partie rapporte : ×1,5 à 2500, ×1,8 à 3000.']),
                h('li', 'Une partie de moins de 10 coups (5 chacun) ne rapporte rien.'),
            ]),
        ]),
    ];
}

function vueGenerale(lignes: LigneGenerale[], infos: PalmaresInfos, moi: string): VNode[] {
    if (!lignes.length) return [h('div.vide', [h('p', "Personne n'est encore classé sur ce plateau.")])];
    return [h('ol.liste', lignes.map((l, i) => h('li', { class: { moi: l.u === moi, podium: i < 3 } }, [
        h('span.rang', String(i + 1)),
        h('span.qui', [nom(l.u, infos, moi), h('small', `${l.nb} partie${l.nb > 1 ? 's' : ''}`)]),
        h('span.points', [`${l.r}${l.prov ? ' ?' : ''}`]),
    ])))];
}

export function palmaresView(model: PyChessModel): VNode[] {
    const moi = model.anon === 'True' ? '' : model.username;
    let onglet: Onglet = 'semaine';
    let infos: PalmaresInfos | null = null;
    let el: VNode | Element | null = null;

    const rendre = (): VNode => {
        const bouton = (o: Onglet, texte: string) => h('button', {
            class: { on: onglet === o }, attrs: { type: 'button', 'aria-pressed': String(onglet === o) },
            on: { click: () => { onglet = o; maj(); } },
        }, texte);
        const contenu = !infos
            ? [h('p.remise', 'Chargement…')]
            : onglet === 'semaine' ? vueSemaine(infos, moi) : vueGenerale(infos.general[onglet], infos, moi);
        return h('div.palmares-contenu', [
            h('div.onglets', { attrs: { role: 'group', 'aria-label': 'Palmarès' } }, [
                bouton('semaine', 'Cette semaine'), bouton('matatakmini', 'Matatak Mini'), bouton('matatak', 'Matatak'),
            ]),
            h('section.panneau', contenu),
        ]);
    };
    const maj = () => { if (el) el = patch(el, rendre()); };

    return [h('div.palmares-page', [
        h('h1', 'Palmarès'),
        h('div.palmares-contenu', {
            hook: {
                insert: (vnode) => {
                    el = vnode.elm as Element;
                    maj();
                    chargerPalmares().then(i => { infos = i; maj(); }).catch(() => { /* hors ligne */ });
                },
            },
        }),
    ])];
}
