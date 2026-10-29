// Écran de l'Aventure (onglet Solo de /jouer) : un escalier de losanges sur un damier, qui monte vers
// la Colline, avec la carte à débloquer de chaque niveau dans une case voisine ; le guide parle en haut,
// un seul bouton en bas (Hugo, 26/10/2026, d'après l'Apprendre de chess.com).

import { h, VNode } from 'snabbdom';

import type { Saison } from '../rois';
import { IMAGE, Nom, Roi, ROIS_DANS_L_ORDRE, SAISON_DU_ROI } from './personnages';
import {
    commencer, demanderPersistance, effacer, enregistrer, erreurEquipe, etapeEnCours, lire,
    Partie, partieARejouer, placesActuelles, prochainePartie, Progression,
} from './progression';
import { equipeEtEnclos, oublierChoix } from './enclos';
import { intro, introVue } from './intro';
import { enveloppeAnimee } from '../carteAnimee';
import { composition, Plateau, route } from './route';

const CARTES = '/static/images/background/collection/';
const carte = (nom: Nom | Roi, face: 'clair' | 'sombre' = 'sombre') => `${CARTES}${face}/${IMAGE[nom]}`;
// Cartes de la route : 720 px dès qu'un écran est net (×2 et plus) ; le fichier de 360 px, très
// compressé, paraît flou même s'il a assez de pixels
const srcset = (nom: Nom | Roi, face: 'clair' | 'sombre') => `${CARTES}${face}/${IMAGE[nom]} 1x, ${CARTES}${face}-720/${IMAGE[nom]} 2x`;

const TITRE_DU_ROI: Record<Saison, string> = { printemps: 'Roi du Printemps', ete: "Roi de l'Été", automne: "Roi de l'Automne", hiver: "Roi de l'Hiver" };

// Chapitres de la route : une phase, une Saison (couleur), un titre (Hugo, 27/10/2026 : sans le nombre de places)
const CHAPITRES: Record<number, { titre: string, saison: Saison }> = {
    1: { titre: 'Premiers défis', saison: 'ete' },
    2: { titre: 'Nouvelles recrues', saison: 'automne' },
    3: { titre: 'Équipe complète', saison: 'hiver' },
    4: { titre: 'Sauteurs fous', saison: 'printemps' },
};

// Le chemin monte en escalier sur un damier de losanges : 3 cases vers le haut à droite, puis 3 vers
// le haut à gauche (colonnes −1, 0, 1 ; la case du virage sert aux deux). Une rangée par niveau.
const COLONNES = [-1, 0, 1, 0];
// Une carte à débloquer dans la case du coin, en face de chaque virage (une rangée sur deux) : elle montre
// la recrue du virage ou du niveau suivant, celle qui reste à gagner

export interface ContexteAventure {
    choixAdv: VNode; // Aventure · Défier un ami · Arène
    plateau: Plateau;
    choisirPlateau: (v: Plateau) => void;
    envoi: boolean; // partie demandée, en attente du serveur
    lancer: (partie: Partie) => void;
    partieLibre: () => void;
    maj: () => void;
    tutoriel: Tutoriel; // le niveau 0
}

/** Le tutoriel, niveau 0 de l'Aventure : fait (fini ou règles déjà connues), sinon son lien. */
export interface Tutoriel {
    fait: boolean;
    lien: string; // /tutorial/N : l'étape où le joueur s'est arrêté
    commence: boolean;
    passer: () => void; // « Je connais déjà les règles »
}

// État de l'écran (pas besoin de le garder d'une visite à l'autre)
let ecran: 'route' | 'equipe' = 'route';
let confirmerEffacement = false;
// Niveau déjà gagné touché : on demande avant de le rejouer (Hugo, 27/10/2026)
let aRejouer: { etape: number, match: number, numero: number, contre: string } | null = null;

// ---------- Premier lancement : le choix du Roi ----------

// Même équipe de départ pour tous les Rois (Hugo, 27/10/2026) : pas de difficulté ni de conseil
function choixDuRoi(ctx: ContexteAventure): VNode {
    const choisir = (roi: Roi) => {
        enregistrer(commencer(roi, ctx.plateau));
        demanderPersistance();
        ecran = 'route';
        // Le tutoriel (niveau 0) tout de suite, guidé par ce Roi
        if (!ctx.tutoriel.fait) window.location.assign(ctx.tutoriel.lien);
        else ctx.maj();
    };
    return h('div.av-accueil', [
        h('div.av-titre', [h('b', 'Choisis ton Roi'), h('small', "Il te guide pendant toute l'Aventure.")]),
        h('div.av-rois', ROIS_DANS_L_ORDRE.map(roi =>
            h(`button.av-roi.${SAISON_DU_ROI[roi]}`, { attrs: { type: 'button' }, on: { click: () => choisir(roi) } }, [
                h('img', { attrs: { src: carte(roi), alt: '' } }),
                h('b', roi),
                h('small', TITRE_DU_ROI[SAISON_DU_ROI[roi]]),
            ])
        )),
        h('p.av-meme-equipe', 'Pas de bon ou de mauvais choix : tous les Rois partent avec la même équipe.'),
        h('button.av-lien', { attrs: { type: 'button' }, on: { click: ctx.partieLibre } }, 'Partie libre, sans Aventure'),
    ]);
}

// ---------- La route ----------

function phraseDuGuide(p: Progression, tutoriel: Tutoriel): string {
    if (!tutoriel.fait) return "Avant d'affronter les Rois rivaux, apprenons les règles : deux minutes suffisent.";
    const etape = etapeEnCours(p);
    if (!etape) return 'Tu as recruté tout le monde. La jungle est à toi !';
    const reste = etape.equipes.length - p.victoires;
    if (p.victoires > 0) return `Encore ${reste} victoire${reste > 1 ? 's' : ''} et ${etape.recrue} nous rejoint.`;
    if (etape.reflet) return `Ton reflet t'attend avec ${etape.recrue}. Bats-toi toi-même !`;
    return `${etape.rival} arrive avec ${etape.recrue}. Gagne et ${etape.recrue} nous rejoint.`;
}

/** La carte d'un niveau, dans une case du damier : elle tourne sur elle-même de temps en temps tant
 *  qu'elle reste à débloquer (face sombre devant, face claire au dos), immobile une fois recrutée. */
function carteDuNiveau(nom: Nom, rangee: number, colonne: number, etat: 'fait' | 'courant' | 'a-venir', index: number, eventail = 0): VNode {
    return h(`div.av-carte.${etat}`, {
        key: `carte-${index}`,
        // Deux recrues au même virage (phase 1 : une partie par niveau) : en éventail, -1 et +1
        style: { '--r': String(rangee), '--k': String(colonne), '--eventail': String(eventail) },
        attrs: { title: nom },
    }, [enveloppeAnimee('flotte', h('span.carte-3d', [
        h('img.face.avant', { attrs: { src: carte(nom, 'sombre'), srcset: srcset(nom, 'sombre'), alt: '' } }),
        h('img.face.dos', { attrs: { src: carte(nom, 'clair'), srcset: srcset(nom, 'clair'), alt: '' } }),
    ]))]);
}

/** Une case du chemin : un losange en relief à la couleur de la Saison du chapitre (pâle tant qu'il reste
 *  à jouer, vive une fois gagné), or sur le niveau en cours ; le numéro reste. La case 0 est le tutoriel. */
function caseDuNiveau(c: Case, rangee: number, lancer: () => void): VNode {
    const fait = c.etat === 'fait';
    const courant = c.etat === 'courant';
    return h(`button.av-niveau.${c.saison}`, {
        key: `niveau-${c.numero}`,
        class: { fait, courant, choisi: aRejouer?.numero === c.numero },
        style: { '--r': String(rangee), '--k': String(COLONNES[c.numero % 4]) },
        attrs: { type: 'button', 'aria-disabled': String(!courant && !fait), 'aria-label': c.libelle },
        // Niveau pas encore débloqué : le toucher est refusé, la case tremble (Hugo, 27/10/2026)
        on: { click: courant || fait ? lancer : (ev: MouseEvent) => refuser(ev.currentTarget as HTMLElement) },
    }, [h('span.av-relief'), h('span.av-dessus', [h('span', String(c.numero))])]);
}

function refuser(el: HTMLElement) {
    el.classList.remove('refuse');
    void el.offsetWidth; // relance l'animation
    el.classList.add('refuse');
}

/** Une case de la route : le tutoriel (niveau 0), puis une case par partie de l'Aventure (Hugo : « une
 *  case par match » ; une étape de 2 victoires prend 2 cases). */
interface Case {
    numero: number;
    phase: number;
    saison: Saison;
    etape: number | null; // null : le tutoriel
    match: number; // la combientième partie de l'étape
    contre: string;
    recrue: Nom | null; // sur la dernière partie de l'étape seulement
    etat: 'fait' | 'courant' | 'a-venir';
    libelle: string;
}

function lesCases(p: Progression, tutoriel: Tutoriel): Case[] {
    const cases: Case[] = [{
        numero: 0, phase: 1, saison: CHAPITRES[1].saison, etape: null, match: 0, contre: '', recrue: null,
        etat: tutoriel.fait ? 'fait' : 'courant',
        libelle: tutoriel.fait ? 'Niveau 0 : revoir les règles' : 'Niveau 0 : apprendre à jouer',
    }];
    route(p.roi).forEach((e, i) => {
        e.equipes.forEach((_, m) => {
            const n = cases.length;
            const fait = i < p.etape || (i === p.etape && m < p.victoires);
            const courant = tutoriel.fait && i === p.etape && m === p.victoires;
            const contre = e.reflet ? 'votre reflet' : e.rival;
            cases.push({
                numero: n, phase: e.phase, saison: CHAPITRES[e.phase].saison, etape: i, match: m, contre,
                recrue: m === e.equipes.length - 1 ? e.recrue : null,
                etat: fait ? 'fait' : courant ? 'courant' : 'a-venir',
                libelle: fait ? `Niveau ${n} : rejouer contre ${contre}` : courant ? `Niveau ${n} : affronter ${contre}` : `Niveau ${n}`,
            });
        });
    });
    return cases;
}

/** La route vient de s'afficher (onglet Aventure, retour de « Mon équipe ») : on la montre au niveau en
 *  cours, jamais tout en haut. Les cartes s'animent comme toutes les cartes du site (carteAnimee.ts). */
function arriverSurLaRoute(chemin: HTMLElement) {
    requestAnimationFrame(() => chemin.querySelector('.av-niveau.courant')?.scrollIntoView({ block: 'center' }));
}

function leChemin(p: Progression, tutoriel: Tutoriel, lancer: () => void, rejouer: (c: Case) => void): VNode {
    const cases = lesCases(p, tutoriel);
    // Chaque recrue va au virage (case paire) de la dernière partie de son étape, ou juste après : BONGO
    // et FRANK (cases 7 et 8) se retrouvent ensemble, comme leur équipe (Hugo) ; deux au plus par virage,
    // côte à côte
    const parVirage = new Map<number, Case[]>();
    for (const c of cases) {
        if (!c.recrue) continue;
        let v = c.numero + (c.numero % 2);
        while ((parVirage.get(v)?.length ?? 0) >= 2) v += 2;
        parVirage.set(v, [...(parVirage.get(v) ?? []), c]);
    }
    const etatRecrue = (c: Case): Case['etat'] => c.etape! < p.etape ? 'fait' : c.etape === p.etape && tutoriel.fait ? 'courant' : 'a-venir';
    // Du bas (niveau 0) vers le haut (la Colline) : chaque chapitre commence par 2 rangées pour son titre
    // (un nombre pair : l'escalier garde sa place sur le damier)
    const elements: VNode[] = [];
    let rangee = 0;
    let phase = 0;
    cases.forEach((c, i) => {
        if (c.phase !== phase) {
            phase = c.phase;
            const chapitre = CHAPITRES[phase];
            elements.push(h(`p.av-chapitre.${chapitre.saison}`, { key: `chapitre-${phase}`, style: { '--r': String(rangee + 0.5) } }, [
                h('small', `Chapitre ${phase}`), h('b', chapitre.titre),
            ]));
            rangee += 2;
        }
        // Le niveau 0 et les niveaux gagnés se sélectionnent d'abord ; le niveau en cours se lance tout de suite
        const action = c.etat === 'fait' ? () => rejouer(c) : c.etape === null ? () => { window.location.href = tutoriel.lien; } : lancer;
        elements.push(caseDuNiveau(c, rangee, action));
        // Dans le coin du virage : la ou les recrues de ce virage
        const recrues = parVirage.get(i) ?? [];
        recrues.forEach((r, j) => elements.push(
            carteDuNiveau(r.recrue!, rangee, -COLONNES[i % 4], etatRecrue(r), r.numero, recrues.length === 2 ? (j === 0 ? -1 : 1) : 0)));
        rangee += 1;
    });
    // La Colline, au bout de l'escalier (colonne du milieu), sans titre (Hugo, 27/10/2026)
    const colline = rangee + (COLONNES[cases.length % 4] === 0 ? 0 : 1);
    elements.push(h('div.av-colline', { key: 'colline', style: { '--r': String(colline), '--k': '0' } }, [h('span.av-relief'), h('span.av-dessus', [h('span', '✦')])]));
    const rangees = colline + 2;
    return h('div.av-chemin', { style: { '--rangees': String(rangees) }, hook: { insert: v => arriverSurLaRoute(v.elm as HTMLElement) } }, elements);
}

const ouvrirEquipe = (ctx: ContexteAventure) => () => { ecran = 'equipe'; oublierChoix(); ctx.maj(); };

/** /jouer?aventure=equipe (lien « Équipe » de la fin de partie) : la feuille « Mon équipe » s'ouvre tout de suite. */
export function montrerEquipe() {
    ecran = 'equipe';
    oublierChoix();
}

/** À côté du bouton : l'équipe qui va jouer, en petit plateau 2 × 3 (Pions devant, Champion · Roi ·
 *  Champion) ; la toucher ouvre « Mon équipe ». */
function apercuEquipe(p: Progression, ouvrir: () => void): VNode {
    const n = composition(placesActuelles(p));
    const champions = n.champions === 1 ? [0] : [0, 2];
    const vignette = (nom: Nom | Roi | undefined) => nom ? h('img', { attrs: { src: carte(nom), alt: '' } }) : h('i');
    const devant = [0, 1, 2].map(col => vignette(col < n.pions ? p.equipe.pions[col] : undefined));
    const fond = [0, 1, 2].map(col => vignette(col === 1 ? p.roi : champions.includes(col) ? p.equipe.champions[champions.indexOf(col)] : undefined));
    return h('button.av-apercu', { attrs: { type: 'button', 'aria-label': `Équipe, ${placesActuelles(p)} places` }, on: { click: ouvrir } }, [
        h('span.av-apercu-plateau', [...devant, ...fond]),
    ]);
}

function ecranRoute(p: Progression, ctx: ContexteAventure): VNode {
    const etape = etapeEnCours(p);
    const partie = prochainePartie({ ...p, plateau: ctx.plateau });
    const lancer = () => {
        if (!partie || !etape || ctx.envoi) return;
        enregistrer({ ...p, plateau: ctx.plateau });
        ctx.lancer(partie);
    };
    const rejouer = () => {
        // Niveau 0 (le tutoriel, étape -1) : on le refait depuis le début
        if (aRejouer?.etape === -1) { aRejouer = null; window.location.href = ctx.tutoriel.lien; return; }
        const partie = aRejouer && partieARejouer({ ...p, plateau: ctx.plateau }, aRejouer.etape, aRejouer.match);
        aRejouer = null;
        if (partie && !ctx.envoi) ctx.lancer(partie);
    };
    const annuler = () => { aRejouer = null; ctx.maj(); };
    const numero = lesCases(p, ctx.tutoriel).find(c => c.etat === 'courant')?.numero;
    // En haut, le guide qui parle, posé sur les feuilles ; en bas, l'équipe à côté du bouton
    return h('div.av-route', [
        h('div.av-haut', [
            h('div.av-guide', [
                h('img', { attrs: { src: carte(p.roi), alt: p.roi } }),
                h('p', phraseDuGuide(p, ctx.tutoriel)),
            ]),
        ]),
        // Un ancien niveau : le 1er toucher le sélectionne (« Rejouer niveau N »), le 2e le lance (Hugo)
        leChemin(p, ctx.tutoriel, lancer, c => {
            if (aRejouer?.numero === c.numero) return rejouer();
            aRejouer = { etape: c.etape ?? -1, match: c.match, numero: c.numero, contre: c.contre };
            ctx.maj();
        }),
        aRejouer ? h('div.av-action.av-rejouer', [
            h('button.av-lien', { attrs: { type: 'button' }, on: { click: annuler } }, 'Annuler'),
            h('button.mt-btn.mt-btn-or.mt-btn-large.lancer', {
                attrs: { type: 'button', disabled: ctx.envoi, 'aria-label': aRejouer.etape === -1 ? 'Refaire le tutoriel' : `Rejouer le niveau ${aRejouer.numero} contre ${aRejouer.contre}, sans recrue ni victoire` },
                on: { click: rejouer },
            }, ctx.envoi ? 'Préparation…' : aRejouer.etape === -1 ? 'Apprendre à jouer' : `Rejouer niveau ${aRejouer.numero}`),
        ]) : h('div.av-action', [
            apercuEquipe(p, ouvrirEquipe(ctx)),
            !ctx.tutoriel.fait
                ? h('a.mt-btn.mt-btn-or.mt-btn-large.lancer', { attrs: { href: ctx.tutoriel.lien } }, ctx.tutoriel.commence ? 'Reprendre le tutoriel' : 'Apprendre à jouer')
                : etape
                ? h('button.mt-btn.mt-btn-or.mt-btn-large.lancer', { attrs: { type: 'button', disabled: ctx.envoi }, on: { click: lancer } },
                    // « Niveau 9 » (Hugo, 27/10/2026) : la bulle du Roi dit déjà contre qui
                    ctx.envoi ? 'Préparation…' : `Niveau ${numero}`)
                : h('a.mt-btn.mt-btn-or.mt-btn-large.lancer', { attrs: { href: '/collection' } }, 'Voir la Collection'),
            !ctx.tutoriel.fait ? h('button.av-lien.av-passer', { attrs: { type: 'button' }, on: { click: ctx.tutoriel.passer } }, 'Je connais déjà les règles') : '',
        ]),
    ]);
}

// ---------- Mon équipe ----------

function ecranEquipe(p: Progression, ctx: ContexteAventure): VNode {
    const places = placesActuelles(p);
    const erreur = erreurEquipe(p, p.equipe);
    // Une feuille plein écran par-dessus la route (qui garde sa place) : rien d'autre en dessous, ni onglets,
    // ni navigation, ni bandeau d'installation ; on revient par « Route » ou Échap
    const fermer = () => { ecran = 'route'; oublierChoix(); ctx.maj(); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') fermer(); };
    return h('div.av-equipe', {
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Équipe' },
        hook: {
            insert: () => { document.body.classList.add('av-page'); document.addEventListener('keydown', echap); },
            destroy: () => { document.body.classList.remove('av-page'); document.removeEventListener('keydown', echap); },
        },
    }, [
        h('div.av-equipe-tete', [
            h('button.av-retour', { attrs: { type: 'button', 'aria-label': "Retour à l'Aventure" }, on: { click: fermer } }, [
                h('svg', { attrs: { viewBox: '0 0 24 24', 'aria-hidden': 'true' } }, [h('path', { attrs: { d: 'M15 5 8 12l7 7' } })]),
                'Aventure',
            ]),
            h('b', 'Équipe'), // sans article, comme les titres du livret (Hugo)
            h('small', `${places} places`),
        ]),
        ...equipeEtEnclos(p, places, ctx.maj),
        erreur ? h('p.av-erreur', erreur) : '',
        h('div.av-bas', [reglagePlateau(ctx), h('div.av-liens', [
            h('a.av-lien', { attrs: { href: '/collection' } }, 'Voir la Collection'),
            h('button.av-lien', { attrs: { type: 'button' }, on: { click: ctx.partieLibre } }, 'Partie libre'),
            confirmerEffacement
                ? h('span.av-confirmer', [
                    'Tout effacer ? ',
                    h('button.av-lien', { attrs: { type: 'button' }, on: { click: () => { effacer(); confirmerEffacement = false; ecran = 'route'; ctx.maj(); } } }, 'Oui'),
                    h('button.av-lien', { attrs: { type: 'button' }, on: { click: () => { confirmerEffacement = false; ctx.maj(); } } }, 'Non'),
                ])
                : h('button.av-lien', { attrs: { type: 'button' }, on: { click: () => { confirmerEffacement = true; ctx.maj(); } } }, "Recommencer l'Aventure"),
        ]),
        h('small.av-sauvegarde', "Votre progression est gardée sur cet appareil. Installez l'appli pour ne pas la perdre."),
        ]),
    ]);
}

// Taille du plateau : automatique par défaut (Mini sur téléphone, 8 × 8 sur ordinateur et tablette) ;
// couper l'interrupteur, ou choisir un plateau, garde ce choix (Hugo, 26/10/2026)
const CLE_AUTO = 'matatak_aventure_plateau_auto';
function plateauAuto(): boolean {
    try { return localStorage.getItem(CLE_AUTO) !== 'non'; } catch { return true; }
}
function noterPlateauAuto(auto: boolean) {
    try { localStorage.setItem(CLE_AUTO, auto ? 'oui' : 'non'); } catch { /* navigation privée */ }
}
const plateauDeLEcran = (): Plateau => (matchMedia('(max-width: 760px)').matches ? 'matatakmini' : 'matatak');

function reglagePlateau(ctx: ContexteAventure): VNode {
    const auto = plateauAuto();
    return h('div.av-reglage', [
        h('span', 'Plateau'),
        h('label.interrupteur', [
            h('input', {
                props: { type: 'checkbox', checked: auto },
                on: { change: (e: Event) => {
                    const oui = (e.target as HTMLInputElement).checked;
                    noterPlateauAuto(oui);
                    if (!oui) ctx.choisirPlateau(ctx.plateau); // on garde celui de l'écran
                    else ctx.maj();
                } },
            }),
            h('span.glissiere'),
            h('span', [h('b', "Selon l'écran"), h('small', 'Mini sur téléphone, 8 × 8 sur ordinateur et tablette.')]),
        ]),
        h('div.av-plateaux', { attrs: { role: 'group', 'aria-label': 'Plateau' } }, (['matatakmini', 'matatak'] as Plateau[]).map(v =>
            h('button', {
                class: { on: ctx.plateau === v },
                attrs: { type: 'button', 'aria-pressed': String(ctx.plateau === v) },
                on: { click: () => { noterPlateauAuto(false); ctx.choisirPlateau(v); } },
            }, v === 'matatakmini' ? 'Mini · 4 × 8' : 'Grand · 8 × 8'))),
    ]);
}

/** Onglet Solo quand le joueur connaît les règles (sinon /jouer propose le tutoriel). */
export function renderAventure(ctxLobby: ContexteAventure): VNode {
    const ctx = { ...ctxLobby, plateau: plateauAuto() ? plateauDeLEcran() : ctxLobby.plateau };
    const p = lire();
    // Première visite : l'intro (plein écran), puis le choix du Roi
    if (!p && !introVue()) return h('section.aventure', [intro(ctx.maj)]);
    if (!p) return h('section.aventure', [h('div.av-onglets', [ctx.choixAdv]), choixDuRoi(ctx)]);
    return h('section.aventure', [
        h('div.av-onglets', [ctx.choixAdv]),
        ecranRoute(p, ctx),
        // Toucher en dehors de la fenêtre (ordinateur, tablette) la ferme
        ecran === 'equipe' ? h('div.av-feuille', {
            on: { click: (e: MouseEvent) => { if (e.target === e.currentTarget) { ecran = 'route'; oublierChoix(); ctx.maj(); } } },
        }, [ecranEquipe(p, ctx)]) : '',
    ]);
}
