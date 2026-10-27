import { h, VNode } from 'snabbdom';

import { patch } from './document';
import { sound } from './sound';
import { lire as lireAventure, roisDebloques, terminee } from './aventure/progression';
import { route } from './aventure/route';
import { PyChessModel } from './types';

// Collection : tous les Personnages en grandes cartes ; une carte touchée ouvre sa fiche (carte qui se
// retourne, infos, déplacements sur le vrai plateau, mini-jeu chronométré de captures).
// Données : static/data/collection.json (généré par server/build_collection_json.py).

export interface Case { dx: number; dy: number; genre: 'libre' | 'deplace' | 'capture'; saut: boolean; repete: boolean; illimite: boolean }
interface Personnage {
    nom: string; espece: string; rang: 'roi' | 'champion' | 'pion'; saison: string;
    boite: 'base' | 'extension'; etoiles: number; replique: string; image: string; cases: Case[];
}
interface Donnees { saisons: Record<string, string>; personnages: Personnage[] }

const RANGS = { roi: 'Roi', champion: 'Champion', pion: 'Pion' };
const RANGS_PLURIEL = { roi: 'Rois', champion: 'Champions', pion: 'Pions' };
const FORCES = ['', 'Commune', 'Rare', 'Épique', 'Légendaire'];
const LIONNES = ['SHANS', 'KARMA'];
const IMG = '/static/images/background/collection/';
const PLATEAU = IMG + 'plateaux/matatak8x8-720.webp';
// Case de départ : d2 pour un Pion (sa vraie ligne, la promotion reste atteignable), d3 pour les autres
// (près du centre, on voit toutes leurs directions)
const depart = (p: Personnage) => (p.rang === 'pion' ? { x: 3, y: 1 } : { x: 3, y: 2 });
const N = 8;

let donnees: Donnees | null = null;
let filtreSaison = 'toutes';
let filtreBoite = 'toutes';
// « Tout débloqué » : l'affichage seul, comme si l'Aventure était finie (pour qui vient du livret et ne joue
// pas en ligne, Hugo 26/10/2026) ; la progression n'est pas touchée. Gardé sur l'appareil.
type FiltreAventure = 'tout' | 'debloques' | 'comme-debloque';
const CLE_FILTRE = 'matatak_collection_filtre';
let filtreAventure: FiltreAventure = (() => {
    try { return localStorage.getItem(CLE_FILTRE) === 'comme-debloque' ? 'comme-debloque' : 'tout'; } catch { return 'tout'; }
})();
function choisirFiltreAventure(f: FiltreAventure) {
    filtreAventure = f;
    try { localStorage.setItem(CLE_FILTRE, f); } catch { /* navigation privée */ }
    rendre();
}

/** Aventure (client/aventure) : Personnages recrutés, et pour les autres, où ils arrivent sur la route.
 *  null si le joueur n'a pas commencé l'Aventure sur cet appareil. */
function etatAventure(): { debloques: Set<string>, arrivee: Map<string, string> } | null {
    const p = lireAventure();
    if (!p) return null;
    const debloques = new Set<string>([...p.recrues, p.roi]);
    if (roisDebloques(p)) ['AZAR', 'SHANS', 'KARMA', 'MOJO'].forEach(r => debloques.add(r));
    const arrivee = new Map<string, string>();
    route(p.roi).forEach((e, i) => arrivee.set(e.recrue, `Niveau ${i + 1}`));
    ['AZAR', 'SHANS', 'KARMA', 'MOJO'].forEach(r => { if (!debloques.has(r)) arrivee.set(r, 'Après la phase 1'); });
    // Variantes de Saison (et les autres Suricates) : récompense de fin d'Aventure
    if (terminee(p)) donnees?.personnages.forEach(x => debloques.add(x.nom));
    return { debloques, arrivee };
}
// Fin du tutoriel : /collection#equipes ne montre que les 4 équipes de départ, puis « Première partie »
let modeEquipes = false;

// Équipes de départ (livret, page 3), dans l'ordre de difficulté
const EQUIPES = [
    { saison: 'ete', nom: 'Fougue', difficulte: 1, phrase: 'Facile à prendre en main.', persos: ['AZAR', 'KRAK', 'TAMTAM'] },
    { saison: 'automne', nom: 'Zen', difficulte: 2, phrase: "Pour jouer l'esprit tranquille.", persos: ['SHANS', 'ROKK', 'SHASHA'] },
    { saison: 'hiver', nom: 'Zigzag', difficulte: 3, phrase: 'Zigzaguez entre les lignes adverses.', persos: ['KARMA', 'FRANK', 'BONGO'] },
    { saison: 'printemps', nom: 'Charme', difficulte: 4, phrase: 'Plus technique, mais pleine de surprises.', persos: ['MOJO', 'DYSKO', 'BANJO'] },
];
let racine: VNode | HTMLElement;

// ---------- Moteur de déplacement ----------
export type Marque = 'libre' | 'deplace' | 'capture';
const cle = (x: number, y: number) => `${x},${y}`;
const surPlateau = (x: number, y: number) => x >= 0 && x < N && y >= 0 && y < N;
const pgcd = (a: number, b: number): number => (b === 0 ? a : pgcd(b, a % b));

/**
 * Cases atteignables depuis `de` (x = colonne a..h, y = rangée 1..8, vers l'avant = y croissant).
 * - sans `ennemis` : vue théorique sur plateau vide, chaque case avec sa sorte de déplacement
 *   (les cases « capture seule » comprises) ;
 * - avec `ennemis` : coups réellement jouables, 'deplace' (case vide) ou 'capture' ;
 * - avec `attaque` : cases que le Personnage menace (vides ou occupées), `ennemis` = cases occupées.
 * `taille` : plateau de `l` colonnes sur `h` rangées (8 × 8 par défaut ; l'enclos de l'Aventure est plus étroit).
 */
export function destinations(cases: Case[], de: { x: number; y: number }, ennemis?: Set<string>, attaque = false,
    taille = { l: N, h: N }): Map<string, Marque> {
    const res = new Map<string, Marque>();
    const surPlateau = (x: number, y: number) => x >= 0 && x < taille.l && y >= 0 && y < taille.h;
    const theorique = ennemis === undefined;
    const ajouter = (x: number, y: number, m: Marque) => {
        const k = cle(x, y), avant = res.get(k);
        res.set(k, avant && avant !== m ? 'libre' : m);
    };
    // Vide : déplacement si permis ; adversaire : capture si permise. Renvoie vrai si la case est vide.
    const essayer = (x: number, y: number, genre: Case['genre']): boolean => {
        const occupe = !theorique && ennemis!.has(cle(x, y));
        if (attaque) { if (genre !== 'deplace') ajouter(x, y, 'capture'); }
        else if (theorique) ajouter(x, y, genre);
        else if (occupe && genre !== 'deplace') ajouter(x, y, 'capture');
        else if (!occupe && genre !== 'capture') ajouter(x, y, 'deplace');
        return !occupe;
    };
    // Glissades et sauts répétés : regroupés par direction élémentaire, parcourus case par case
    const directions = new Map<string, { ux: number; uy: number; max: number; genre: Case['genre'] }>();
    for (const c of cases) {
        if (c.saut && !c.repete) { // saut simple : directement sur la case d'arrivée
            const x = de.x + c.dx, y = de.y + c.dy;
            if (surPlateau(x, y)) essayer(x, y, c.genre);
            continue;
        }
        const n = pgcd(Math.abs(c.dx), Math.abs(c.dy));
        const ux = c.dx / n, uy = c.dy / n;
        const k = `${ux},${uy},${c.repete}`;
        const max = c.illimite ? Math.max(taille.l, taille.h) : n;
        const d = directions.get(k);
        if (!d) directions.set(k, { ux, uy, max, genre: c.genre });
        else d.max = Math.max(d.max, max);
    }
    for (const d of directions.values()) {
        for (let i = 1; i <= d.max; i++) {
            const x = de.x + d.ux * i, y = de.y + d.uy * i;
            if (!surPlateau(x, y)) break;
            if (!essayer(x, y, d.genre)) break; // un Personnage arrête la glissade ou le saut répété
        }
    }
    return res;
}

const position = (x: number, y: number) => ({ left: `${x * 12.5}%`, top: `${(N - 1 - y) * 12.5}%` });

/** Un adversaire regarde vers le bas du plateau : ses déplacements sont tournés d'un demi-tour. */
const tourner = (cases: Case[]): Case[] => cases.map(c => ({ ...c, dx: -c.dx, dy: -c.dy }));

/**
 * Coups jouables par `p` en `de` face aux `ennemis` (case -> Personnage). Un Roi n'a pas le droit de se
 * mettre en échec : on retire les cases menacées, y compris la capture d'un adversaire protégé.
 */
export function coupsJouables(p: Personnage, de: { x: number; y: number }, ennemis: Map<string, Personnage>): Map<string, Marque> {
    const coups = destinations(p.cases, de, new Set(ennemis.keys()));
    if (p.rang !== 'roi') return coups;
    for (const k of [...coups.keys()]) {
        const restants = [...ennemis].filter(([e]) => e !== k);
        const occupees = new Set(restants.map(([e]) => e)); // le Roi a quitté sa case : elle ne protège plus
        const menacee = restants.some(([e, q]) => {
            const [x, y] = e.split(',').map(Number);
            return destinations(tourner(q.cases), { x, y }, occupees, true).has(k);
        });
        if (menacee) coups.delete(k);
    }
    return coups;
}

const el = (tag: string, classe = '', texte = '') => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte) e.textContent = texte;
    return e;
};
const bouton = (classe: string, texte: string, onclick: () => void) => {
    const b = el('button', classe, texte) as HTMLButtonElement;
    b.type = 'button';
    b.onclick = onclick;
    return b;
};
const srcset = (face: string, image: string) => `${IMG}${face}/${image} 360w, ${IMG}${face}-720/${image} 720w`;

function notes(p: Personnage): string[] {
    const n: string[] = [];
    if (p.cases.some(c => c.illimite && !c.saut && !c.repete)) n.push('Glissade sans limite : jusqu\'au bord, ou jusqu\'à un Personnage.');
    if (p.cases.some(c => c.repete)) n.push('Saut répété : le saut se répète dans la même direction tant que la voie est libre.');
    else if (p.cases.some(c => c.saut)) n.push('Saut : par-dessus les autres Personnages.');
    if (p.cases.some(c => c.genre === 'deplace')) n.push('Losange creux : seulement vers une case libre.');
    if (p.cases.some(c => c.genre === 'capture')) n.push('Losange bleu : seulement pour capturer.');
    if (p.rang === 'roi') n.push('Roi : il ne peut pas aller sur une case menacée par un adversaire.');
    if (p.rang === 'pion') n.push('Pion : arrivé au bout du plateau, il est promu (dans le mini-jeu : +1 et retour au départ).');
    return n;
}

// ---------- Plateau de la fiche : déplacements, puis mini-jeu chronométré ----------
const DUREE = 30; // secondes de jeu
const VIE = 4500; // ms : un adversaire non capturé repart
const CADENCE = 1000; // ms entre deux apparitions
const MAX_ENNEMIS = 4;

const lireRecord = (nom: string) => { try { return Number(localStorage.getItem(`collection-record-${nom}`)) || 0; } catch { return 0; } };
const ecrireRecord = (nom: string, v: number) => { try { localStorage.setItem(`collection-record-${nom}`, String(v)); } catch { /* navigation privée */ } };

/** Construit le plateau et le mini-jeu dans `zone` ; renvoie la fonction qui arrête le jeu. */
function plateauEtJeu(p: Personnage, zone: HTMLElement): () => void {
    const adversaires = donnees!.personnages.filter(q => q.nom !== p.nom && q.rang !== 'roi'); // pas de Roi en face
    const plateau = el('div', 't-plateau');
    plateau.style.backgroundImage = `url(${PLATEAU})`;
    const perso = el('i', 't-perso');
    perso.style.backgroundImage = `url(${IMG}clair/${p.image})`;
    plateau.appendChild(perso);
    const temps = el('div', 't-temps');
    const jauge = el('i');
    temps.appendChild(jauge);
    const score = el('span', 't-score');
    score.setAttribute('role', 'status');
    const jouer = bouton('mt-btn mt-btn-petit mt-btn-or t-jouer', `Jouer : ${DUREE} s`, () => demarrer());
    // Pour sortir d'une manche lancée par erreur (aucun record enregistré)
    const stop = bouton('mt-btn mt-btn-petit mt-btn-ligne t-stop', 'Arrêter', () => abandonner());
    stop.hidden = true;
    const barre = el('div', 't-barre');
    barre.append(score, jouer, stop);
    const DEPART = depart(p);
    // Légende seulement si le Personnage a des cases « seulement » (Suricates…), et seulement celles-là
    const sortes = new Set(destinations(p.cases, DEPART).values());
    const legende = el('div', 'legende');
    if (sortes.has('deplace') || sortes.has('capture')) {
        for (const [m, t] of [['libre', 'Se déplace ou capture'], ['deplace', 'Se déplace seulement'], ['capture', 'Capture seulement']]) {
            if (!sortes.has(m as Marque)) continue;
            const s = el('span');
            s.append(el('i', `m-${m}`), t);
            legende.appendChild(s);
        }
    }
    const ul = el('ul', 'notes');
    notes(p).forEach(t => ul.appendChild(el('li', '', t)));
    zone.append(...(legende.childElementCount ? [legende] : []), plateau, temps, barre, ul);

    const placer = (e: HTMLElement, x: number, y: number) => Object.assign(e.style, position(x, y));
    let pos = { ...DEPART };
    let ennemis = new Map<string, { q: Personnage; e: HTMLElement; fin: number }>();
    let points = 0, finPartie = 0, prochain = 0, horloge = 0;
    const record = () => lireRecord(p.nom);

    // Vue de départ : toutes les cases atteignables, sur plateau vide
    function theorie() {
        plateau.querySelectorAll('.marque, .t-cible').forEach(e => e.remove());
        destinations(p.cases, DEPART).forEach((m, k) => {
            const [x, y] = k.split(',').map(Number);
            const i = el('i', `marque m-${m}`);
            placer(i, x, y);
            plateau.appendChild(i);
        });
        placer(perso, DEPART.x, DEPART.y);
        const r = record();
        score.textContent = r ? `Record : ${r}` : `Capturez le plus d'adversaires possible en ${DUREE} s !`;
    }

    function cibles() {
        plateau.querySelectorAll('.marque, .t-cible').forEach(e => e.remove());
        const occupants = new Map([...ennemis].map(([k, v]) => [k, v.q]));
        const coups = coupsJouables(p, pos, occupants);
        coups.forEach((m, k) => {
            const [x, y] = k.split(',').map(Number);
            // Souris et doigt passent par le pointerdown du plateau (les cases sont recréées à chaque apparition,
            // un clic commencé sur une ancienne case serait perdu) ; ce clic-ci ne sert qu'au clavier.
            const b = bouton(m === 'capture' ? 't-cible capture' : 't-cible', '', () => {});
            b.onclick = (e) => { if (e.detail === 0) aller(x, y); };
            b.setAttribute('aria-label', `${m === 'capture' ? 'Capturer en' : 'Aller en'} ${'abcdefgh'[x]}${y + 1}`);
            placer(b, x, y);
            plateau.appendChild(b);
        });
        placer(perso, pos.x, pos.y);
        if (coups.size === 0) setTimeout(() => { if (horloge) { pos = { ...DEPART }; cibles(); } }, 450); // bloqué : retour au départ
    }

    function effet(classe: string, x: number, y: number, texte = '') {
        const f = el('i', classe, texte);
        placer(f, x, y);
        plateau.appendChild(f);
        setTimeout(() => f.remove(), 800);
    }

    function retirer(k: string, capture: boolean) {
        const v = ennemis.get(k);
        if (!v) return;
        ennemis.delete(k);
        if (!capture) { v.e.classList.add('part'); setTimeout(() => v.e.remove(), 350); return; }
        v.e.remove();
        const [x, y] = k.split(',').map(Number);
        effet('t-eclat', x, y);
    }

    function aller(x: number, y: number) {
        const k = cle(x, y);
        let gain = 0;
        if (ennemis.has(k)) { retirer(k, true); gain++; sound.capture(); }
        else sound.move();
        pos = { x, y };
        // Pion au bout du plateau : promu, +1, puis il glisse jusqu'à sa case de départ
        const promu = p.rang === 'pion' && y === N - 1;
        if (promu) {
            sound.promotion();
            gain++;
            setTimeout(() => { if (horloge) { pos = { ...DEPART }; cibles(); } }, 450);
        }
        if (gain) effet('t-plus', x, y, `+${gain}`);
        points += gain;
        afficherScore();
        cibles();
    }

    function apparaitre() {
        const occupants = new Map([...ennemis].map(([k, v]) => [k, v.q]));
        const libres: string[] = [];
        for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
            const k = cle(x, y);
            if (!ennemis.has(k) && !(x === pos.x && y === pos.y)) libres.push(k);
        }
        // Le plus souvent sur une case prenable, pour que le jeu reste jouable ; sinon au hasard
        const prenables = libres.filter(k => coupsJouables(p, pos, new Map([...occupants, [k, p]])).get(k) === 'capture');
        const choix = prenables.length && Math.random() < (p.rang === 'pion' ? 0.85 : 0.7) ? prenables : libres;
        const k = choix[Math.floor(Math.random() * choix.length)];
        const q = adversaires[Math.floor(Math.random() * adversaires.length)];
        const e = el('i', 't-ennemi');
        e.style.backgroundImage = `url(${IMG}sombre/${q.image})`;
        const [x, y] = k.split(',').map(Number);
        placer(e, x, y);
        plateau.appendChild(e);
        ennemis.set(k, { q, e, fin: performance.now() + VIE });
    }

    let dernierTic = 0;
    function afficherScore() {
        const reste = Math.max(0, Math.ceil((finPartie - performance.now()) / 1000));
        if (reste <= 3 && reste > 0 && reste !== dernierTic) { dernierTic = reste; sound.tick(); } // 3, 2, 1
        score.textContent = `${points} point${points > 1 ? "s" : ""} · ${reste} s`;
    }

    function tic() {
        const t = performance.now();
        jauge.style.transform = `scaleX(${Math.max(0, (finPartie - t) / (DUREE * 1000))})`;
        if (t >= finPartie) return terminer();
        let change = false;
        for (const [k, v] of ennemis) if (t >= v.fin) { retirer(k, false); change = true; }
        if (t >= prochain && ennemis.size < MAX_ENNEMIS) { apparaitre(); prochain = t + CADENCE; change = true; }
        if (change) cibles();
        afficherScore();
    }

    function demarrer() {
        arreter();
        pos = { ...DEPART };
        points = 0;
        finPartie = performance.now() + DUREE * 1000;
        prochain = 0;
        dernierTic = 0;
        sound.genericNotify(); // même son qu'au début d'une partie
        zone.classList.add('en-jeu');
        jouer.hidden = true;
        stop.hidden = false;
        apparaitre(); // deux adversaires d'emblée
        tic();
        horloge = window.setInterval(tic, 100);
    }

    function arreter() {
        window.clearInterval(horloge);
        horloge = 0;
        ennemis.forEach(v => v.e.remove());
        ennemis = new Map();
    }

    function abandonner() {
        arreter();
        zone.classList.remove('en-jeu');
        stop.hidden = true;
        jauge.style.transform = 'scaleX(0)';
        theorie();
        jouer.hidden = false;
        jouer.focus();
    }

    function terminer() {
        arreter();
        zone.classList.remove('en-jeu');
        stop.hidden = true;
        jauge.style.transform = 'scaleX(0)';
        const ancien = record();
        if (points > ancien) ecrireRecord(p.nom, points);
        if (points > ancien && points > 0) sound.victory(); else sound.draw();
        theorie();
        score.textContent = `Temps écoulé : ${points} point${points > 1 ? "s" : ""}` +
            (points > ancien ? (ancien ? ' · nouveau record !' : '') : ` · record : ${ancien}`);
        jouer.textContent = 'Recommencer';
        jouer.hidden = false;
        jouer.focus();
    }

    // Seul le bouton lance le mini-jeu (toucher le plateau pour faire défiler la page le lançait par
    // erreur, Hugo 23/10/2026) ; en jeu, toucher une case atteignable y déplace le Personnage
    plateau.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || !horloge) return;
        const r = plateau.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * N), y = N - 1 - Math.floor((e.clientY - r.top) / r.height * N);
        if (surPlateau(x, y) && coupsJouables(p, pos, new Map([...ennemis].map(([k, v]) => [k, v.q]))).has(cle(x, y))) {
            e.preventDefault(); // pas de clic fantôme ni de sélection
            aller(x, y);
        }
    });

    theorie();
    return arreter;
}

// ---------- Fiche détaillée (ouverte depuis la grille) ----------
function ouvrirFiche(p: Personnage, liste: Personnage[]) {
    document.getElementById('fiche-perso')?.remove();
    const d = el('dialog', 'detail') as HTMLDialogElement;
    d.id = 'fiche-perso';
    d.style.setProperty('--c', `var(--mt-${p.saison})`);
    d.setAttribute('aria-label', p.nom);

    const carte = bouton('carte3d grand', '', () => {
        carte.classList.toggle('retournee');
        carte.setAttribute('aria-pressed', String(carte.classList.contains('retournee')));
    });
    carte.setAttribute('aria-label', `Retourner la carte de ${p.nom}`);
    carte.setAttribute('aria-pressed', 'false');
    for (const face of ['sombre', 'clair']) {
        const img = el('img', `face ${face}`) as HTMLImageElement;
        img.srcset = srcset(face, p.image);
        img.sizes = '(max-width: 760px) calc(100vw - 48px), 440px';
        img.src = `${IMG}${face}-720/${p.image}`;
        img.alt = `Carte de ${p.nom}, face ${face}`;
        carte.appendChild(img);
    }
    const colCarte = el('div', 'd-carte');
    colCarte.append(carte, el('p', 'd-astuce', 'Touchez la carte pour la retourner'));

    const infos = el('div', 'd-infos');
    const espece = LIONNES.includes(p.nom) ? 'Lionne' : p.espece;
    const identite = el('div', 'identite');
    identite.append(el('span', '', `${espece} · ${RANGS[p.rang]}`), el('span', 'saison', donnees!.saisons[p.saison]));
    if (p.boite === 'extension') identite.appendChild(el('span', 'ext', 'Extension'));
    const force = p.etoiles > 0
        ? el('div', `force f${p.etoiles}`, ' ' + FORCES[p.etoiles])
        : el('div', 'force roi', 'Roi : son échec et mat décide de la partie');
    if (p.etoiles > 0) force.prepend(el('span', 'etoiles', '✦'.repeat(p.etoiles)));
    infos.append(el('h2', 'd-nom', p.nom), identite, force);
    // Espaces insécables dans les guillemets et avant ? ! : (typographie française)
    if (p.replique) infos.appendChild(el('p', 'replique', p.replique.replace(/« /g, '« ').replace(/ ([»?!:;])/g, ' $1')));

    const zone = el('div', 'd-depl');
    const arreterJeu = plateauEtJeu(p, zone);

    // Personnage précédent / suivant, dans l'ordre de la grille filtrée
    const i = liste.indexOf(p);
    const nav = el('nav', 'd-nav');
    if (i > 0) nav.appendChild(bouton('d-prec', `‹ ${liste[i - 1].nom}`, () => ouvrirFiche(liste[i - 1], liste)));
    if (i < liste.length - 1) nav.appendChild(bouton('d-suiv', `${liste[i + 1].nom} ›`, () => ouvrirFiche(liste[i + 1], liste)));


    const fermer = bouton('d-fermer', '×', () => d.close());
    fermer.setAttribute('aria-label', 'Fermer');
    d.append(fermer, colCarte, infos, zone, nav);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => { arreterJeu(); d.remove(); });
    document.body.appendChild(d);
    d.showModal();
    fermer.blur();
}

// ---------- Grille : les cartes seules, comme un classeur ----------
function carteGrille(p: Personnage, liste: Personnage[], aventure: ReturnType<typeof etatAventure> = null): VNode {
    const verrou = aventure !== null && !aventure.debloques.has(p.nom);
    return h('button.carte-col', {
        key: p.nom,
        class: { verrou },
        style: { '--c': `var(--mt-${p.saison})` },
        attrs: { type: 'button', 'aria-label': `${p.nom} : voir la fiche` },
        on: { click: () => ouvrirFiche(p, liste) },
    }, [
        // Recto-verso : la carte tourne sur elle-même quand elle arrive à l'écran (observerLesCartes)
        h('span.carte-3d', [
            h('img.face.avant', { attrs: {
                srcset: srcset('sombre', p.image), sizes: TAILLES,
                src: `${IMG}sombre/${p.image}`, alt: '', loading: 'lazy', width: 360, height: 360,
            } }),
            h('img.face.dos', { attrs: {
                srcset: srcset('clair', p.image), sizes: TAILLES,
                src: `${IMG}clair/${p.image}`, alt: '', loading: 'lazy', width: 360, height: 360,
            } }),
        ]),
        h('span.nom', p.nom),
        verrou ? h('span.arrivee', aventure!.arrivee.get(p.nom) ?? 'Fin de l\'Aventure')
            : p.etoiles > 0 ? h(`span.force.f${p.etoiles}`, h('span.etoiles', '✦'.repeat(p.etoiles))) : h('span.force.roi', 'Roi'),
    ]);
}

function puce(actif: boolean, texte: string, onClick: () => void): VNode {
    return h('button.puce', { class: { on: actif }, attrs: { type: 'button', 'aria-pressed': String(actif) }, on: { click: onClick } }, texte);
}

function vueEquipes(d: Donnees): VNode {
    const parNom = new Map(d.personnages.map(p => [p.nom, p]));
    const ordre = EQUIPES.flatMap(e => e.persos.map(n => parNom.get(n)!).filter(Boolean));
    return h('div.collection-page.equipes-depart', [
        h('header.tete', [
            h('h1', 'Les équipes de départ'),
            h('p', 'Chaque joueur commence avec l\'une de ces 4 équipes : un Roi, un Champion et deux Pions. Touchez une carte pour voir comment le Personnage se déplace.'),
        ]),
        ...EQUIPES.map(e => h('section.equipe', { style: { '--c': `var(--mt-${e.saison})` } }, [
            h('div.equipe-tete', [
                h('h2', [d.saisons[e.saison], h('span', ` · ${e.nom}`)]),
                h('span.difficulte', { attrs: { 'aria-label': `Difficulté ${e.difficulte} sur 4` } },
                    [1, 2, 3, 4].map(i => h('i', { class: { plein: i <= e.difficulte } }))),
            ]),
            h('p.phrase', e.phrase),
            h('div.fiches.trois', e.persos.map(n => parNom.get(n)).filter(Boolean).map(p => carteGrille(p!, ordre))),
        ])),
        h('div.equipes-suite', [
            h('a.mt-btn.mt-btn-or', { attrs: { href: '/jouer/solo?variant=matatakmini&level=1' } }, 'Première partie'),
            h('a.tout', {
                attrs: { href: '/collection' },
                on: { click: (ev: Event) => { ev.preventDefault(); modeEquipes = false; history.replaceState(null, '', '/collection'); rendre(); window.scrollTo(0, 0); } },
            }, 'Voir toute la Collection'),
        ]),
    ]);
}

function vue(): VNode {
    if (!donnees) return h('div.collection-page', h('p.chargement', 'Chargement de la collection…'));
    const d = donnees;
    if (modeEquipes) return vueEquipes(d);
    const avancement = etatAventure();
    const aventure = filtreAventure === 'comme-debloque' ? null : avancement;
    const visibles = d.personnages.filter(p =>
        (filtreSaison === 'toutes' || p.saison === filtreSaison) && (filtreBoite === 'toutes' || p.boite === filtreBoite)
        && (filtreAventure === 'tout' || !aventure || aventure.debloques.has(p.nom)));
    const ordre = (['roi', 'champion', 'pion'] as const).flatMap(rang => visibles.filter(p => p.rang === rang));
    const sections = (['roi', 'champion', 'pion'] as const).map(rang => {
        const liste = visibles.filter(p => p.rang === rang);
        return liste.length ? h('section.rang', [h('h2', `${RANGS_PLURIEL[rang]} · ${liste.length}`), h('div.fiches', liste.map(p => carteGrille(p, ordre, aventure)))]) : '';
    });
    const nbBase = d.personnages.filter(p => p.boite === 'base').length;
    return h('div.collection-page', [
        h('header.tete', [
            h('h1', 'Collection'),
            h('p', `Les ${d.personnages.length} Personnages de MATATAK : ${nbBase} dans le jeu de base, les autres dans les extensions. Touchez une carte pour voir le Personnage, ses déplacements, et le mettre à l'épreuve.`),
        ]),
        h('div.filtres', [
            h('div.groupe', { attrs: { role: 'group', 'aria-label': 'Saison' } }, [
                puce(filtreSaison === 'toutes', 'Toutes', () => { filtreSaison = 'toutes'; rendre(); }),
                ...Object.entries(d.saisons).map(([k, nom]) => h('span', { style: { '--c': `var(--mt-${k})` } }, [
                    puce(filtreSaison === k, nom, () => { filtreSaison = k; rendre(); })])),
            ]),
            h('div.groupe', { attrs: { role: 'group', 'aria-label': 'Boîte' } }, [
                puce(filtreBoite === 'toutes', 'Tout', () => { filtreBoite = 'toutes'; rendre(); }),
                puce(filtreBoite === 'base', 'Jeu de base', () => { filtreBoite = 'base'; rendre(); }),
                puce(filtreBoite === 'extension', 'Extensions', () => { filtreBoite = 'extension'; rendre(); }),
            ]),
            avancement ? h('div.groupe', { attrs: { role: 'group', 'aria-label': 'Aventure' } }, [
                puce(filtreAventure === 'tout', 'Tous', () => choisirFiltreAventure('tout')),
                puce(filtreAventure === 'debloques', `Débloqués · ${d.personnages.filter(p => avancement.debloques.has(p.nom)).length}`, () => choisirFiltreAventure('debloques')),
                puce(filtreAventure === 'comme-debloque', 'Tout débloqué', () => choisirFiltreAventure('comme-debloque')),
            ]) : '',
        ]),
        ...sections,
    ]);
}

const TAILLES = '(max-width: 760px) 50vw, (max-width: 1150px) 25vw, 320px';

// Défilement « satisfaisant » (Hugo, 23/10/2026) : chaque carte fait un tour sur elle-même en entrant à
// l'écran, à chaque passage, avec un petit décalage par colonne (effet de vague)
let observateur: IntersectionObserver | null = null;
function observerLesCartes() {
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    observateur ??= new IntersectionObserver(entrees => entrees.forEach(e => {
        const carte = e.target as HTMLElement;
        if (!e.isIntersecting) { carte.classList.remove('entre'); return; }
        const freres = [...(carte.parentElement?.children ?? [])];
        const colonnes = getComputedStyle(carte.parentElement!).gridTemplateColumns.split(' ').length || 1;
        carte.style.setProperty('--retard', `${(freres.indexOf(carte) % colonnes) * 90}ms`);
        carte.classList.add('entre');
    }), { threshold: 0.35 });
    document.querySelectorAll('.carte-col').forEach(c => observateur!.observe(c));
}

function rendre() {
    racine = patch(racine, vue());
    observerLesCartes();
}

export function collectionView(_model: PyChessModel): VNode[] {
    // QR code « Extensions » du livret : /livret/extensions -> /collection#extensions
    if (window.location.hash === '#extensions') filtreBoite = 'extension';
    modeEquipes = window.location.hash === '#equipes';
    return [h('div.collection-page', {
        hook: {
            insert: vnode => {
                racine = vnode.elm as HTMLElement;
                rendre();
                fetch('/static/data/collection.json')
                    .then(r => r.json())
                    .then((d: Donnees) => { donnees = d; rendre(); })
                    .catch(() => { racine = patch(racine, h('div.collection-page', h('p.chargement', 'La collection n\'a pas pu être chargée. Rechargez la page.'))); });
            },
        },
    })];
}
