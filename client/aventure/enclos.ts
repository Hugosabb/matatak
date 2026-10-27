// « Mon équipe » de l'Aventure : l'équipe sur un petit plateau 2 × 3 (collé en haut de l'écran) et, dessous,
// un enclos en damier où les recrues hors de l'équipe se promènent avec leurs vrais déplacements, sans
// jamais se capturer. On glisse un Personnage sur une case de son rang pour l'engager (celui qui y était
// retourne dans l'enclos) ; deux cases de l'équipe s'échangent de la même façon. Toucher puis toucher
// marche aussi. Idée d'Hugo (26/10/2026), façon Mii : on voit chacun bouger.

// Pas de badge d'étoiles de Force ici (Hugo, 26/10/2026) : la carte les montre déjà, et l'Aventure n'est pas
// faite pour ne jouer que les légendaires (l'ordinateur s'adapte de toute façon aux résultats).

import { h, VNode } from 'snabbdom';

import { Case, destinations } from '../collection';
import { sound } from '../sound';
import { IMAGE, Nom, PERSONNAGES, Roi, ROIS_DANS_L_ORDRE } from './personnages';
import { changerEquipe, changerRoi, enregistrer, Progression, roisDebloques } from './progression';
import { composition, Equipe, numeroDeCase, route } from './route';

const CARTES = '/static/images/background/collection/';
const src = (nom: Nom | Roi) => `${CARTES}sombre/${IMAGE[nom]}`; // face sombre dans les menus (Hugo)
const srcset = (nom: Nom | Roi) => `${CARTES}sombre/${IMAGE[nom]} 1x, ${CARTES}sombre-720/${IMAGE[nom]} 2x`;

// Téléphone en portrait : 4 colonnes (« souvent par 4 », comme la Collection), une rangée par Personnage
// au-delà de 6. Écran large (ordinateur, tablette, téléphone en paysage) : un enclos 8 × 8, l'équipe à
// côté, comme une partie (Hugo, 26/10/2026) ; 24 Personnages au plus sur 64 cases.
const ECRAN_LARGE = '(min-width: 761px), (max-height: 500px) and (orientation: landscape)';
let COLONNES = 4;
const PAS_PROMENADE = 1700; // un Personnage bouge toutes les 1,7 s

type Perso = Nom | Roi;
type Rang = 'roi' | 'champion' | 'pion';
interface Place { rang: Rang, index: number }
type Source = { de: 'enclos', nom: Perso } | { de: 'equipe', place: Place };

const estRoi = (nom: Perso): nom is Roi => (ROIS_DANS_L_ORDRE as string[]).includes(nom);
const rangDe = (nom: Perso): Rang => (estRoi(nom) ? 'roi' : PERSONNAGES[nom].rang);
const cle = (x: number, y: number) => `${x},${y}`;

// Déplacements de chaque Personnage (static/data/collection.json, comme la Collection), chargés une fois
let deplacements: Map<string, Case[]> | null = null;
let chargement = false;
function chargerDeplacements(maj: () => void) {
    if (deplacements || chargement) return;
    chargement = true;
    fetch('/static/data/collection.json')
        .then(r => r.json())
        .then((d: { personnages: { nom: string, cases: Case[] }[] }) => {
            deplacements = new Map(d.personnages.map(x => [x.nom, x.cases]));
            maj();
        })
        .catch(() => { chargement = false; });
}

// État de l'écran, gardé d'un rendu à l'autre : où est chacun dans l'enclos, et ce qui est touché
const positions = new Map<Perso, { x: number, y: number }>();
let rangees = 3;
let choix: Source | null = null;
let glisse = false; // un glisser est en cours : la promenade attend
// « Trier » : tous rangés depuis le haut (Rois, Champions, Pions, dans l'ordre de recrutement), immobiles ;
// en le coupant, ils s'éparpillent et reprennent la promenade (Hugo). Gardé sur l'appareil.
const CLE_TRI = 'matatak_aventure_enclos_trie';
let trie = (() => { try { return localStorage.getItem(CLE_TRI) === 'oui'; } catch { return false; } })();
function changerTri(oui: boolean, maj: () => void) {
    trie = oui;
    try { localStorage.setItem(CLE_TRI, oui ? 'oui' : 'non'); } catch { /* navigation privée */ }
    positions.clear(); // rangés, ou éparpillés au hasard
    choix = null;
    maj();
}

/** Les Personnages hors de l'équipe : recrues (un seul exemplaire de chacun) et Rois quand ils sont débloqués. */
function libres(p: Progression): Perso[] {
    const dans = new Set<Perso>([...p.equipe.champions, ...p.equipe.pions]);
    const liste: Perso[] = [...new Set(p.recrues)].filter(n => !dans.has(n));
    if (roisDebloques(p)) liste.push(...ROIS_DANS_L_ORDRE.filter(r => r !== p.roi));
    return liste;
}

/** Une place dans l'enclos pour chaque Personnage libre : environ une case sur quatre est occupée, pour
 *  qu'ils aient de la place pour se promener. */
function placerDansEnclos(liste: Perso[]) {
    const large = matchMedia(ECRAN_LARGE).matches;
    COLONNES = large ? 8 : 4;
    rangees = large ? 8 : Math.max(6, Math.ceil((liste.length * 4) / COLONNES));
    for (const nom of [...positions.keys()]) {
        const pos = positions.get(nom)!;
        if (!liste.includes(nom) || pos.y >= rangees || pos.x >= COLONNES) positions.delete(nom);
    }
    if (trie) {
        const ordre = { roi: 0, champion: 1, pion: 2 };
        [...liste].sort((a, b) => ordre[rangDe(a)] - ordre[rangDe(b)]).forEach((nom, i) =>
            positions.set(nom, { x: i % COLONNES, y: rangees - 1 - Math.floor(i / COLONNES) }));
        return;
    }
    const prises = new Set([...positions.values()].map(q => cle(q.x, q.y)));
    for (const nom of liste) {
        if (positions.has(nom)) continue;
        const vides: { x: number, y: number }[] = [];
        for (let y = 0; y < rangees; y++) for (let x = 0; x < COLONNES; x++) if (!prises.has(cle(x, y))) vides.push({ x, y });
        const pos = vides[Math.floor(Math.random() * vides.length)];
        positions.set(nom, pos);
        prises.add(cle(pos.x, pos.y));
    }
}

/** Cases où `nom` peut aller dans l'enclos (jamais sur un autre Personnage : on ne se capture pas), vers
 *  l'avant = vers le haut, comme dans le mini-jeu de la Collection. */
function casesDansEnclos(nom: Perso): { x: number, y: number }[] {
    const cases = deplacements?.get(nom);
    const de = positions.get(nom);
    if (!cases || !de) return [];
    const occupees = new Set([...positions.entries()].filter(([n]) => n !== nom).map(([, q]) => cle(q.x, q.y)));
    const res: { x: number, y: number }[] = [];
    destinations(cases, de, occupees, false, { l: COLONNES, h: rangees }).forEach((m, k) => {
        if (m !== 'deplace') return;
        const [x, y] = k.split(',').map(Number);
        res.push({ x, y });
    });
    return res;
}

/** Un Pion arrivé au bout de l'enclos repart de la première rangée, comme dans le mini-jeu (il y glisse,
 *  dans sa colonne si la case est libre). */
function retourDuPion(nom: Perso): boolean {
    const pos = positions.get(nom);
    if (!pos || rangDe(nom) !== 'pion' || pos.y !== rangees - 1) return false;
    const prises = new Set([...positions.values()].map(q => cle(q.x, q.y)));
    const colonnes = [...Array(COLONNES).keys()].sort((a, b) => Math.abs(a - pos.x) - Math.abs(b - pos.x));
    const x = colonnes.find(c => !prises.has(cle(c, 0)));
    if (x === undefined) return false;
    positions.set(nom, { x, y: 0 });
    return true;
}

/** Place la carte de l'enclos là où `positions` la met : la position n'est jamais lue ailleurs, l'écran et
 *  le calcul des cases ne peuvent pas se contredire. */
function caler(el: HTMLElement) {
    const pos = positions.get(el.dataset.nom as Perso);
    if (!pos) return;
    el.style.setProperty('--x', String(pos.x));
    el.style.setProperty('--y', String(pos.y));
}

// Passage portrait ↔ paysage (ou fenêtre redimensionnée) : l'enclos change de forme, on redessine
let ecouteLargeur = false;
function suivreLaLargeur(maj: () => void) {
    if (ecouteLargeur) return;
    ecouteLargeur = true;
    matchMedia(ECRAN_LARGE).addEventListener('change', () => { if (document.querySelector('.av-enclos')) maj(); });
}

let minuteur = 0;
/** La promenade : un Personnage au hasard fait un de ses déplacements (un Pion arrivé au bout repart de la
 *  première rangée). La carte est recalée sans redessiner tout l'écran. */
function promenade(enclos: HTMLElement) {
    window.clearInterval(minuteur);
    minuteur = window.setInterval(() => {
        if (!enclos.isConnected) { window.clearInterval(minuteur); return; }
        if (glisse || choix || trie || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const noms = [...positions.keys()];
        if (!noms.length) return;
        // Un Pion arrivé en haut redescend en priorité (sinon il peut attendre longtemps d'être tiré au sort)
        const enHaut = noms.find(n => rangDe(n) === 'pion' && positions.get(n)!.y === rangees - 1 && retourDuPion(n));
        const nom = enHaut ?? noms[Math.floor(Math.random() * noms.length)];
        if (!enHaut) {
            const cases = casesDansEnclos(nom);
            if (cases.length) positions.set(nom, cases[Math.floor(Math.random() * cases.length)]);
            else if (!retourDuPion(nom)) return;
        }
        const el = enclos.querySelector<HTMLElement>(`[data-nom="${nom}"]`);
        if (el) caler(el);
        sound.moveDiscret(); // plus vivant (Hugo), mais plus bas que les coups du joueur
    }, PAS_PROMENADE);
}

// ---------- Changer l'équipe ----------

function nomA(p: Progression, place: Place): Perso | null {
    if (place.rang === 'roi') return p.roi;
    return (place.rang === 'champion' ? p.equipe.champions : p.equipe.pions)[place.index] ?? null;
}

function accepte(p: Progression, source: Source, place: Place): boolean {
    if (place.rang === 'roi' && !roisDebloques(p)) return false;
    const nom = source.de === 'enclos' ? source.nom : nomA(p, source.place);
    if (!nom || rangDe(nom) !== place.rang) return false;
    return !(source.de === 'equipe' && source.place.rang === place.rang && source.place.index === place.index);
}

/** Pose `source` sur `place` : un Personnage de l'enclos prend la place (l'ancien retourne à sa case de
 *  l'enclos), deux places de l'équipe s'échangent. */
function poser(p: Progression, source: Source, place: Place) {
    if (!accepte(p, source, place)) return;
    sound.move();
    if (trie) positions.clear(); // trié : on range de nouveau, au prochain affichage
    if (source.de === 'equipe') {
        if (place.rang === 'roi') return; // un seul Roi dans l'équipe
        const equipe: Equipe = { champions: [...p.equipe.champions], pions: [...p.equipe.pions] };
        const liste = place.rang === 'champion' ? equipe.champions : equipe.pions;
        [liste[place.index], liste[source.place.index]] = [liste[source.place.index], liste[place.index]];
        enregistrer(changerEquipe(p, equipe));
        return;
    }
    const ancien = nomA(p, place);
    const pos = positions.get(source.nom);
    positions.delete(source.nom);
    if (ancien && pos) positions.set(ancien, pos);
    if (place.rang === 'roi') {
        enregistrer(changerRoi(p, source.nom as Roi));
        return;
    }
    const equipe: Equipe = { champions: [...p.equipe.champions], pions: [...p.equipe.pions] };
    (place.rang === 'champion' ? equipe.champions : equipe.pions)[place.index] = source.nom as Nom;
    enregistrer(changerEquipe(p, equipe));
}

/** Déplacer un Personnage dans l'enclos, sur une de ses cases (comme dans le mini-jeu de la Collection). */
function deplacerDansEnclos(nom: Perso, x: number, y: number): boolean {
    if (trie) return false;
    if (!casesDansEnclos(nom).some(q => q.x === x && q.y === y)) return false;
    positions.set(nom, { x, y });
    sound.move();
    // Arrivé au bout, un Pion repart de la première rangée un instant plus tard
    if (rangDe(nom) === 'pion' && y === rangees - 1) {
        window.setTimeout(() => {
            if (!retourDuPion(nom)) return;
            const el = document.querySelector<HTMLElement>(`.av-enclos [data-nom="${nom}"]`);
            if (el) caler(el);
        }, 700);
    }
    return true;
}

/** Toucher sans glisser : on choisit, puis on touche la case où le poser (ou l'autre case à échanger). */
function toucher(p: Progression, source: Source, maj: () => void) {
    const place = source.de === 'equipe' ? source.place : null;
    if (choix && place && accepte(p, choix, place)) {
        poser(p, choix, place);
        choix = null;
    } else if (choix && source.de === 'enclos' && choix.de === 'equipe' && accepte(p, source, choix.place)) {
        poser(p, source, choix.place);
        choix = null;
    } else if (choix && memeSource(choix, source)) {
        choix = null;
    } else {
        choix = source;
    }
    maj();
}

const memeSource = (a: Source, b: Source) => a.de === 'enclos'
    ? b.de === 'enclos' && a.nom === b.nom
    : b.de === 'equipe' && a.place.rang === b.place.rang && a.place.index === b.place.index;

/** Appui sur un Personnage : au-delà de 6 px, il suit le doigt (une copie de la carte) ; relâché sur une
 *  case autorisée de l'équipe, il y est posé. Sans mouvement, c'est un simple toucher. */
function appuyer(e: PointerEvent, p: Progression, source: Source, maj: () => void) {
    if (e.button !== 0) return;
    const carteEl = (e.currentTarget as HTMLElement).querySelector('img');
    if (!carteEl) return;
    const depart = { x: e.clientX, y: e.clientY };
    let fantome: HTMLElement | null = null;
    const ecran = (e.currentTarget as HTMLElement).closest('.av-equipe') as HTMLElement;
    const cases = [...ecran.querySelectorAll<HTMLElement>('.av-case[data-rang]')];
    const placeDe = (el: HTMLElement): Place => ({ rang: el.dataset.rang as Rang, index: Number(el.dataset.index) });
    // Depuis l'enclos, il peut aussi se déplacer dans l'enclos, sur ses vraies cases
    const libresEnclos = source.de === 'enclos' && !trie
        ? new Set(casesDansEnclos(source.nom).map(q => cle(q.x, q.y))) : new Set<string>();
    const dalles = [...ecran.querySelectorAll<HTMLElement>('.av-enclos > i')];
    // Depuis l'équipe, on peut aussi le lâcher sur un remplaçant de l'enclos : ils s'échangent
    const remplacants = source.de === 'equipe'
        ? [...ecran.querySelectorAll<HTMLElement>('.av-perso')].filter(el => accepte(p, { de: 'enclos', nom: el.dataset.nom as Perso }, source.place)) : [];
    const cibleSous = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest<HTMLElement>('.av-case[data-rang]') ?? remplacants.find(r => r.contains(el)) ?? el?.closest<HTMLElement>('.av-enclos > i') ?? null;
    };
    const bouger = (ev: PointerEvent) => {
        if (!fantome && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) < 6) return;
        if (!fantome) {
            glisse = true;
            const b = carteEl.getBoundingClientRect();
            fantome = carteEl.cloneNode() as HTMLElement;
            fantome.className = 'av-fantome';
            fantome.style.width = `${b.width}px`;
            document.body.appendChild(fantome);
            cases.forEach(c => c.classList.toggle('accepte', accepte(p, source, placeDe(c))));
            dalles.forEach(d => d.classList.toggle('accepte', libresEnclos.has(cle(Number(d.dataset.x), Number(d.dataset.y)))));
            remplacants.forEach(r => r.classList.add('accepte'));
            ecran.classList.add('glisse');
        }
        fantome.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%, -50%) scale(1.12) rotate(-4deg)`;
        const sous = cibleSous(ev.clientX, ev.clientY);
        [...cases, ...dalles, ...remplacants].forEach(c => c.classList.toggle('dessous', c === sous));
    };
    const lacher = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', bouger);
        document.removeEventListener('pointerup', lacher);
        document.removeEventListener('pointercancel', lacher);
        if (!fantome) { toucher(p, source, maj); return; }
        fantome.remove();
        ecran.classList.remove('glisse');
        [...cases, ...dalles, ...remplacants].forEach(c => c.classList.remove('accepte', 'dessous'));
        glisse = false;
        const sous = ev.type === 'pointerup' ? cibleSous(ev.clientX, ev.clientY) : null;
        if (sous?.dataset.rang) poser(p, source, placeDe(sous));
        else if (sous?.dataset.nom && source.de === 'equipe') poser(p, { de: 'enclos', nom: sous.dataset.nom as Perso }, source.place);
        else if (sous && source.de === 'enclos') deplacerDansEnclos(source.nom, Number(sous.dataset.x), Number(sous.dataset.y));
        choix = null;
        maj();
    };
    document.addEventListener('pointermove', bouger);
    document.addEventListener('pointerup', lacher);
    document.addEventListener('pointercancel', lacher);
}

// ---------- Affichage ----------

function carteJouable(nom: Perso, p: Progression, source: Source, maj: () => void, sel: string, extra: Record<string, unknown> = {}): VNode {
    const choisi = choix !== null && memeSource(choix, source);
    return h(sel, {
        ...extra,
        class: { choisi, ...(extra.class as Record<string, boolean> ?? {}) },
        attrs: { type: 'button', 'aria-label': nom, 'aria-pressed': String(choisi), ...(extra.attrs as Record<string, string> ?? {}) },
        on: {
            pointerdown: (e: PointerEvent) => appuyer(e, p, source, maj),
            // clavier (Entrée, Espace) : pas de pointerdown
            click: (e: MouseEvent) => { if (e.detail === 0) toucher(p, source, maj); },
        },
    }, [h('img', { attrs: { src: src(nom), srcset: srcset(nom), alt: '', draggable: 'false' } })]);
}

/** Le plateau de l'équipe, vu du joueur : Pions devant, puis Champion · Roi · Champion. Une place pas encore
 *  débloquée est fermée : un cadenas et le niveau où elle s'ouvre (un losange vide donnait envie d'y poser
 *  quelqu'un, Hugo). */
function plateauEquipe(p: Progression, places: number, maj: () => void): VNode {
    const n = composition(places);
    const ouverture = (minimum: number) => {
        const etapes = route(p.roi);
        const i = etapes.findIndex(e => e.places >= minimum);
        return i >= 0 ? `Niveau ${numeroDeCase(etapes, i)}` : 'Plus tard';
    };
    const champions = n.champions === 1 ? [0] : [0, 2];
    const cible = (place: Place) => choix !== null && accepte(p, choix, place);
    const caseDe = (place: Place | null, col: number, ligne: number) => {
        const sombre = (col + ligne) % 2 === 0;
        if (!place) {
            const quand = ouverture(ligne === 0 ? 5 : 6); // 3e Pion à 5 places, 2e Champion à 6
            return h('span.av-case.verrou', { attrs: { 'aria-label': `Place fermée, ouverte au ${quand.toLowerCase()}` } }, [
                h('svg', { attrs: { viewBox: '0 0 24 24', 'aria-hidden': 'true' } }, [
                    h('rect', { attrs: { x: 5, y: 11, width: 14, height: 10, rx: 2.5 } }),
                    h('path', { attrs: { d: 'M8 11V8a4 4 0 0 1 8 0v3', fill: 'none' } }),
                ]),
                h('small', quand),
            ]);
        }
        const nom = nomA(p, place)!;
        const fixe = place.rang === 'roi' && !roisDebloques(p);
        const attrs = { 'data-rang': place.rang, 'data-index': String(place.index) };
        if (fixe) return h('span.av-case', { class: { sombre }, attrs }, [h('img', { attrs: { src: src(nom), srcset: srcset(nom), alt: nom } })]);
        return carteJouable(nom, p, { de: 'equipe', place }, maj, 'button.av-case', { class: { sombre, cible: cible(place) }, attrs });
    };
    const devant = [0, 1, 2].map(col => caseDe(col < n.pions ? { rang: 'pion', index: col } : null, col, 0));
    const fond = [0, 1, 2].map(col => caseDe(col === 1 ? { rang: 'roi', index: 0 } : champions.includes(col) ? { rang: 'champion', index: champions.indexOf(col) } : null, col, 1));
    return h('div.av-formation', [...devant, ...fond]);
}

function enclos(p: Progression, maj: () => void): VNode {
    const liste = libres(p);
    placerDansEnclos(liste);
    // Personnage de l'enclos touché : ses cases dans l'enclos, en losanges dorés comme en partie
    const marques = new Set(choix?.de === 'enclos' && !trie ? casesDansEnclos(choix.nom).map(q => cle(q.x, q.y)) : []);
    const fond: VNode[] = [];
    for (let y = 0; y < rangees; y++) {
        for (let x = 0; x < COLONNES; x++) {
            const marque = marques.has(cle(x, y));
            fond.push(h('i', {
                class: { sombre: (x + y) % 2 === 0, marque },
                attrs: { 'data-x': String(x), 'data-y': String(y) },
                style: { '--x': String(x), '--y': String(y) },
                // Une case marquée : il y va ; une autre case : on désélectionne
                on: choix ? { click: () => { if (marque && choix?.de === 'enclos') deplacerDansEnclos(choix.nom, x, y); choix = null; maj(); } } : {},
            }));
        }
    }
    // Personnage de l'équipe touché : ceux de l'enclos qui peuvent le remplacer portent le losange doré
    const remplace = choix?.de === 'equipe' ? choix.place : null;
    const persos = liste.map(nom => {
        return carteJouable(nom, p, { de: 'enclos', nom }, maj, 'button.av-perso', {
            key: nom,
            class: { cible: remplace !== null && accepte(p, { de: 'enclos', nom }, remplace) },
            attrs: { 'data-nom': nom },
            // position posée à chaque affichage depuis `positions` (pas par le style de snabbdom, que la
            // promenade contournerait)
            hook: { insert: (v: VNode) => caler(v.elm as HTMLElement), update: (_: VNode, v: VNode) => caler(v.elm as HTMLElement) },
        });
    });
    return h('div.av-enclos', {
        style: { '--rangees': String(rangees), '--colonnes': String(COLONNES) },
        hook: { insert: v => { promenade(v.elm as HTMLElement); suivreLaLargeur(maj); } },
    }, liste.length ? [...fond, ...persos] : [...fond, h('p.av-enclos-vide', 'Vos recrues vous attendront ici.')]);
}

/** L'écran : le plateau de l'équipe (collé en haut), une phrase d'aide, l'enclos. */
export function equipeEtEnclos(p: Progression, places: number, maj: () => void): VNode[] {
    chargerDeplacements(maj);
    // Phrase courte, dans une hauteur réservée de deux lignes : rien ne bouge quand elle change
    const rang = choix?.de === 'enclos' ? rangDe(choix.nom) : null;
    const aide = !choix ? 'Glissez un Personnage sur une case de son rang.'
        : choix.de === 'equipe' ? 'Touchez un Personnage du même rang.'
        : `Touchez une case ${rang === 'pion' ? 'de Pion' : rang === 'roi' ? 'du Roi' : 'de Champion'}, ou un losange.`;
    return [
        h('div.av-equipe-plateau', [plateauEquipe(p, places, maj)]),
        h('p.av-aide', aide),
        h('label.interrupteur.av-trier', [
            h('input', { props: { type: 'checkbox', checked: trie }, on: { change: (e: Event) => changerTri((e.target as HTMLInputElement).checked, maj) } }),
            h('span.glissiere'),
            h('span', [h('b', 'Trier'), h('small', trie ? 'Rangés depuis le haut.' : 'Ils se promènent.')]),
        ]),
        enclos(p, maj),
    ];
}

/** En quittant l'écran : rien de choisi. */
export function oublierChoix() {
    choix = null;
}
