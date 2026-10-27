// Progression de l'Aventure, gardée sur l'appareil (localStorage) : Roi choisi, recrues, équipe,
// étape en cours, niveau caché de l'ordinateur et flamme (jours joués d'affilée).

import type { Saison } from '../rois';
import { Nom, PERSONNAGES, Roi, SAISON_DU_ROI } from './personnages';
import { composition, Equipe, equipeDeDepart, Etape, Plateau, positionDeDepart, route } from './route';

export interface Progression {
    version: 1;
    roi: Roi;
    recrues: Nom[]; // dans l'ordre d'arrivée, équipe de départ comprise
    equipe: Equipe; // l'équipe du joueur, sans son Roi
    etape: number; // index dans route(roi) ; route(roi).length = Aventure terminée
    victoires: number; // victoires sur l'étape en cours
    niveauOrdi: number; // niveau Fairy-Stockfish (Level N), 1 à 20, ajusté après chaque partie
    parties: number;
    flamme: { jours: number, dernier: string };
    plateau: Plateau;
}

export type Resultat = 'victoire' | 'defaite' | 'nulle';

const CLE = 'matatak_aventure';
const NIVEAU_DEPART = 1; // le plus faible : la première partie doit se gagner (Hugo, 27/10/2026)
const NIVEAU_MAX = 20;
// Grands pas au début, pour qu'un joueur déjà fort trouve vite son niveau
const PARTIES_DE_PLACEMENT = 4;

export function lire(): Progression | null {
    try {
        const p = JSON.parse(localStorage.getItem(CLE) ?? 'null');
        if (p && p.version === 1 && p.roi in { AZAR: 1, SHANS: 1, KARMA: 1, MOJO: 1 }) return p;
    } catch { /* rien d'enregistré ou navigation privée */ }
    return null;
}

export function enregistrer(p: Progression) {
    try {
        localStorage.setItem(CLE, JSON.stringify(p));
    } catch { /* navigation privée : la progression ne dure que le temps de la page */ }
}

export function effacer() {
    try {
        localStorage.removeItem(CLE);
    } catch { /* rien à effacer */ }
}

/** Demande au navigateur de ne pas effacer nos données quand il manque de place (accordé facilement
 *  à une appli installée). Sans effet ailleurs. */
export function demanderPersistance() {
    try {
        navigator.storage?.persist?.();
    } catch { /* navigateur sans cette fonction */ }
}

export function commencer(roi: Roi, plateau: Plateau): Progression {
    const equipe = equipeDeDepart();
    return {
        version: 1,
        roi,
        recrues: [...equipe.champions, ...equipe.pions],
        equipe,
        etape: 0,
        victoires: 0,
        niveauOrdi: NIVEAU_DEPART,
        parties: 0,
        flamme: { jours: 0, dernier: '' },
        plateau,
    };
}

export function etapeEnCours(p: Progression): Etape | null {
    return route(p.roi)[p.etape] ?? null;
}

export function terminee(p: Progression): boolean {
    return etapeEnCours(p) === null;
}

// Un seul exemplaire de chaque Personnage dans l'équipe du joueur (Hugo, 23/10/2026 : il joue ainsi
// plus de Personnages et retient mieux les siens), sauf s'il n'a pas assez de recrues pour remplir.
export const UN_SEUL_EXEMPLAIRE = true;

/** L'équipe du joueur au nombre de places, sans doublon quand il a assez de recrues : une place
 *  nouvelle (ou un doublon) reçoit la recrue la plus récente de ce rang qui n'est pas déjà dans l'équipe. */
export function ajusterEquipe(equipe: Equipe, places: number, recrues: Nom[] = []): Equipe {
    const n = composition(places);
    const remplir = (noms: Nom[], total: number, rang: 'champion' | 'pion') => {
        const libres = recrues.filter(r => PERSONNAGES[r].rang === rang).reverse();
        const equipe: Nom[] = [];
        for (let i = 0; i < total; i++) {
            const voulu = noms[i];
            if (voulu && !(UN_SEUL_EXEMPLAIRE && equipe.includes(voulu) && libres.some(r => !equipe.includes(r) && !noms.includes(r)))) {
                equipe.push(voulu);
                continue;
            }
            const autre = libres.find(r => !equipe.includes(r) && !noms.slice(i + 1).includes(r));
            equipe.push(UN_SEUL_EXEMPLAIRE && autre ? autre : voulu ?? autre ?? noms[0]);
        }
        return equipe;
    };
    return { champions: remplir(equipe.champions, n.champions, 'champion'), pions: remplir(equipe.pions, n.pions, 'pion') };
}

export function placesActuelles(p: Progression): number {
    return (etapeEnCours(p) ?? route(p.roi)[route(p.roi).length - 1]).places;
}

/** null si l'équipe est valable pour la phase en cours, sinon la raison (texte affichable). */
export function erreurEquipe(p: Progression, equipe: Equipe): string | null {
    const n = composition(placesActuelles(p));
    if (equipe.champions.length !== n.champions || equipe.pions.length !== n.pions) {
        return `Ton équipe compte ${n.champions} Champion${n.champions > 1 ? 's' : ''} et ${n.pions} Pions.`;
    }
    for (const [noms, rang] of [[equipe.champions, 'champion'], [equipe.pions, 'pion']] as const) {
        for (const nom of noms) {
            if (!p.recrues.includes(nom)) return `${nom} n'a pas encore rejoint ton équipe.`;
            if (PERSONNAGES[nom].rang !== rang) return `${nom} n'est pas un ${rang === 'pion' ? 'Pion' : 'Champion'}.`;
        }
        // Doublon interdit tant qu'une autre recrue de ce rang peut prendre la place
        const differents = new Set(p.recrues.filter(r => PERSONNAGES[r].rang === rang)).size;
        if (UN_SEUL_EXEMPLAIRE && new Set(noms).size < Math.min(noms.length, differents)) return 'Un seul exemplaire de chaque Personnage.';
    }
    return null;
}

/** Les 4 Rois sont débloqués à la fin de la phase 1 (les 3 rivaux ont été battus). */
export function roisDebloques(p: Progression): boolean {
    return route(p.roi).findIndex(e => e.phase > 1) <= p.etape;
}

/** Le Classé se débloque à la fin de la phase 1, le Draft à la fin de la phase 3 (jeu de base complet). */
export function classeeDebloquee(p: Progression): boolean {
    return roisDebloques(p);
}

export function draftDebloque(p: Progression): boolean {
    const debutPhase4 = route(p.roi).findIndex(e => e.phase > 3);
    return debutPhase4 >= 0 ? debutPhase4 <= p.etape : terminee(p);
}

// « Jouer quand même » : le joueur a ouvert le Classé avant de l'avoir débloqué
const CLE_FORCE = 'matatak_classee_quand_meme';
export function classeeForcee(): boolean {
    try { return localStorage.getItem(CLE_FORCE) === '1'; } catch { return false; }
}
export function forcerClassee() {
    try { localStorage.setItem(CLE_FORCE, '1'); } catch { /* navigation privée */ }
}

/** Changer de Roi (après la phase 1 seulement : les étapes suivantes ne dépendent pas du Roi choisi,
 *  sauf le reflet, qui suit le nouveau Roi). */
export function changerRoi(p: Progression, roi: Roi): Progression {
    return roisDebloques(p) ? { ...p, roi } : p;
}

export function changerEquipe(p: Progression, equipe: Equipe): Progression {
    if (erreurEquipe(p, equipe)) return p;
    return { ...p, equipe };
}

export interface Partie {
    variant: Plateau;
    fen: string;
    couleur: 'w' | 'b'; // couleur du joueur
    niveau: number;
    rival: Roi;
    rois: { white: Saison, black: Saison }; // Roi du joueur et Roi du rival, sur le plateau
    rejouee?: boolean; // une partie déjà gagnée, rejouée pour le plaisir : elle ne compte pas
}

/** La prochaine partie : 1re, le joueur commence (Blancs) ; 2e (la revanche), le rival ; 3e, le joueur. */
export function prochainePartie(p: Progression): Partie | null {
    return partieDuMatch(p, p.etape, p.victoires);
}

/** Une partie déjà gagnée de la route (étape `index`, `match`-ième partie), à rejouer : même équipe de
 *  l'ordinateur, l'équipe actuelle du joueur ajustée aux places de l'époque. Elle ne compte pas. */
export function partieARejouer(p: Progression, index: number, match: number): Partie | null {
    const fait = index < p.etape || (index === p.etape && match < p.victoires);
    const partie = fait ? partieDuMatch(p, index, match) : null;
    return partie ? { ...partie, rejouee: true } : null;
}

function partieDuMatch(p: Progression, index: number, match: number): Partie | null {
    const etape = route(p.roi)[index];
    if (!etape || !etape.equipes[match]) return null;
    const joueur = ajusterEquipe(p.equipe, etape.places, p.recrues);
    const couleur = match % 2 === 0 ? 'w' : 'b';
    const ordi = etape.equipes[match];
    const fen = couleur === 'w' ? positionDeDepart(p.plateau, joueur, ordi) : positionDeDepart(p.plateau, ordi, joueur);
    const joueurS = SAISON_DU_ROI[p.roi], rivalS = SAISON_DU_ROI[etape.rival];
    const rois = couleur === 'w' ? { white: joueurS, black: rivalS } : { white: rivalS, black: joueurS };
    return { variant: p.plateau, fen, couleur, niveau: p.niveauOrdi, rival: etape.rival, rois };
}

function jour(date: Date): string {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function flammeApres(flamme: Progression['flamme'], maintenant: Date): Progression['flamme'] {
    const aujourdhui = jour(maintenant);
    if (flamme.dernier === aujourdhui) return flamme;
    const hier = jour(new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - 1));
    return { jours: flamme.dernier === hier ? flamme.jours + 1 : 1, dernier: aujourdhui };
}

/** Niveau caché : +1 par victoire, −2 par défaite (≈ 2 victoires sur 3), plus vite pendant le placement. */
function niveauApres(niveau: number, resultat: Resultat, parties: number): number {
    const pas = resultat === 'victoire' ? (parties < PARTIES_DE_PLACEMENT ? 3 : 1) : resultat === 'defaite' ? -2 : 0;
    return Math.min(NIVEAU_MAX, Math.max(1, niveau + pas));
}

export interface Bilan {
    progression: Progression;
    recrue: Nom | null; // Personnage qui vient de rejoindre l'équipe
    placesEnPlus: boolean; // l'équipe vient de s'agrandir
    finie: boolean; // dernière recrue de l'Aventure
    debloque?: 'classee' | 'draft'; // mode de jeu qui vient de se débloquer
}

/** Applique le résultat d'une partie de l'étape en cours. Fonction pure : à enregistrer ensuite. */
export function apresPartie(p: Progression, resultat: Resultat, maintenant = new Date()): Bilan {
    const etape = etapeEnCours(p);
    let suite: Progression = {
        ...p,
        niveauOrdi: niveauApres(p.niveauOrdi, resultat, p.parties),
        parties: p.parties + 1,
        flamme: flammeApres(p.flamme, maintenant),
    };
    if (!etape || resultat !== 'victoire') return { progression: suite, recrue: null, placesEnPlus: false, finie: false };

    if (p.victoires + 1 < etape.equipes.length) {
        return { progression: { ...suite, victoires: p.victoires + 1 }, recrue: null, placesEnPlus: false, finie: false };
    }
    const recrues = suite.recrues.includes(etape.recrue) ? suite.recrues : [...suite.recrues, etape.recrue];
    suite = { ...suite, recrues, etape: p.etape + 1, victoires: 0 };
    const prochaine = etapeEnCours(suite);
    const placesEnPlus = !!prochaine && prochaine.places > etape.places;
    // Nouvelle place, ou doublon qu'une recrue peut remplacer
    suite = { ...suite, equipe: ajusterEquipe(suite.equipe, (prochaine ?? etape).places, suite.recrues) };
    const debloque = !classeeDebloquee(p) && classeeDebloquee(suite) ? 'classee' as const
        : !draftDebloque(p) && draftDebloque(suite) ? 'draft' as const : undefined;
    return { progression: suite, recrue: etape.recrue, placesEnPlus, finie: !prochaine, debloque };
}

// ── Partie en cours de l'Aventure ──
// /jouer note la partie demandée (étape, victoires) ; quand le serveur répond, on y ajoute son gameId ;
// à la fin de cette partie, roundCtrl.ts applique le résultat une seule fois et garde le bilan à afficher.

interface PartieNotee {
    gameId: string | null;
    etape: number;
    victoires: number;
    t: number; // date de la demande (ms)
    rejouee?: boolean; // partie déjà gagnée, rejouée : aucun effet sur la progression
    rival?: Roi; // rival de la partie demandée (celui d'une partie rejouée n'est pas celui de l'étape en cours)
    bilan?: { recrue: Nom | null, placesEnPlus: boolean, finie: boolean, resultat: Resultat, debloque?: 'classee' | 'draft' };
}

const CLE_PARTIE = 'matatak_aventure_partie';

function lirePartie(): PartieNotee | null {
    try {
        return JSON.parse(localStorage.getItem(CLE_PARTIE) ?? 'null');
    } catch {
        return null;
    }
}

function ecrirePartie(partie: PartieNotee) {
    try {
        localStorage.setItem(CLE_PARTIE, JSON.stringify(partie));
    } catch { /* navigation privée */ }
}

export function noterPartieDemandee(p: Progression, partie?: Partie) {
    ecrirePartie({
        gameId: null, etape: p.etape, victoires: p.victoires, t: Date.now(),
        ...(partie ? { rival: partie.rival } : {}), ...(partie?.rejouee ? { rejouee: true } : {}),
    });
}

/** La partie en cours est une partie déjà gagnée, rejouée (fin de partie : pas de recrue, pas de suite). */
export function estPartieRejouee(gameId: string): boolean {
    const partie = lirePartie();
    return partie?.gameId === gameId && partie.rejouee === true;
}

// Les dernières parties de l'Aventure, avec leur rival : une partie plus ancienne, rouverte, garde ses
// boutons de l'Aventure et le nom de son rival (avant, seule la dernière était reconnue)
const CLE_ANCIENNES = 'matatak_aventure_parties';
const MAX_ANCIENNES = 60;
function lireAnciennes(): { id: string, rival: Roi }[] {
    try { return JSON.parse(localStorage.getItem(CLE_ANCIENNES) ?? '[]'); } catch { return []; }
}

/** Réponse du serveur (new_game), ou arrivée sur la partie par /jouer/solo : la partie demandée il y a
 *  moins d'une minute reçoit son id. */
export function lierPartie(gameId: string) {
    const partie = lirePartie();
    if (!partie || partie.gameId !== null || Date.now() - partie.t >= 60_000) return;
    ecrirePartie({ ...partie, gameId });
    const p = lire();
    const rival = partie.rival ?? (p ? route(p.roi)[partie.etape]?.rival : undefined);
    if (!rival) return;
    const anciennes = [{ id: gameId, rival }, ...lireAnciennes().filter(x => x.id !== gameId)].slice(0, MAX_ANCIENNES);
    try { localStorage.setItem(CLE_ANCIENNES, JSON.stringify(anciennes)); } catch { /* navigation privée */ }
}

export function estPartieAventure(gameId: string): boolean {
    return estPartieEnCours(gameId) || lireAnciennes().some(x => x.id === gameId);
}

/** La partie en cours de l'Aventure (celle dont le résultat compte), pas une ancienne rouverte. */
export function estPartieEnCours(gameId: string): boolean {
    return lirePartie()?.gameId === gameId;
}

/** Roi rival d'une partie de l'Aventure (panneau d'infos de la partie), null sinon. */
export function rivalDeLaPartie(gameId: string): Roi | null {
    const partie = lirePartie();
    const p = lire();
    if (partie && partie.gameId === gameId && p) return partie.rival ?? route(p.roi)[partie.etape]?.rival ?? null;
    return lireAnciennes().find(x => x.id === gameId)?.rival ?? null;
}

/** Fin d'une partie de l'Aventure : le résultat compte une fois (rechargement de la page compris). */
export function compterPartie(gameId: string, resultat: Resultat): Bilan | null {
    const partie = lirePartie();
    const p = lire();
    if (!partie || partie.gameId !== gameId || !p) return null;
    if (partie.rejouee) return null; // rejouée : ni recrue, ni victoire, ni niveau caché qui bouge
    if (partie.bilan) return { progression: p, ...partie.bilan };
    // La progression a changé entre-temps (autre onglet) : on ne compte pas une partie périmée
    if (partie.etape !== p.etape || partie.victoires !== p.victoires) return null;
    const bilan = apresPartie(p, resultat);
    enregistrer(bilan.progression);
    ecrirePartie({ ...partie, bilan: { recrue: bilan.recrue, placesEnPlus: bilan.placesEnPlus, finie: bilan.finie, resultat, debloque: bilan.debloque } });
    return bilan;
}
