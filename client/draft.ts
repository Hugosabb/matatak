import { h, VNode } from 'snabbdom';

import * as cg from 'chessgroundx/types';
import * as util from 'chessgroundx/util';

import { patch } from './document';
import { premove } from './premoveCgOverride';
import { ROIS, Saison } from './rois';

// Écran du Draft (livret page 8, choix d'Hugo du 22/10/2026), avant le plateau. Le serveur tient
// l'état (server/draft.py) ; ici on l'affiche, on prépare un brouillon (groupes, placement) et on
// envoie seulement des indices. Le choix de l'adversaire est montré avec une pause.

type Couleur = 'white' | 'black';

interface Equipe { pions: string[], arriere: string[], roi: Saison }

export interface EtatDraft {
    phase: 'PIONS_FORMER' | 'PIONS_CHOISIR' | 'CHAMPIONS_FORMER' | 'CHAMPIONS_CHOISIR' | 'PLACEMENT' | 'FINI';
    acteur: Couleur | null;
    pions: string[];
    champions: string[];
    rois: Saison[];
    etoiles: Record<string, number>;
    groupes: { pions: number[][] | null, champions: number[][] | null };
    choix: { pions: number | null, champions: number | null };
    equipes: { white: Equipe | null, black: Equipe | null };
    pret: { white: boolean, black: boolean };
    dernier: { action: string, type: 'pions' | 'champions', couleur: Couleur, groupe?: number } | null;
    fen: string | null;
    reste?: number | null; // partie classée : secondes pour l'étape en cours (server/draft.py)
}

interface Options {
    mycolor: Couleur;
    spectateur: boolean;
    nom: (couleur: Couleur) => string;
    assetURL: string;
    envoyer: (message: Record<string, unknown>) => void;
    fini: (etat: EtatDraft) => void;
}

const PAUSE_CHOIX = 1800; // ms : le temps de voir le groupe pris par l'adversaire

// Rappel des déplacements sous chaque carte (demande d'Hugo : au début, on ne les connaît pas) :
// grille de 5 × 5 ou 7 × 7 cases, le Personnage au centre (d4), vers l'avant = vers le haut. Même calcul
// que les losanges du plateau quand on touche une carte (premoveCgOverride, plateau vide).
const DIMENSIONS: cg.BoardDimensions = { width: 8, height: 8 };
const motifs = new Map<string, Set<string>>();
function motif(lettre: string): Set<string> {
    let m = motifs.get(lettre);
    if (!m) {
        const role = `${lettre}-piece` as cg.Role;
        const etat: cg.BoardState = { pieces: new Map([['d4' as cg.Key, { role, color: 'white' }]]) };
        m = new Set(premove('matatak', false, DIMENSIONS)(etat, 'd4' as cg.Key, false).map(k => util.key2pos(k).join(',')));
        motifs.set(lettre, m);
    }
    return m;
}
function grilleDeplacements(lettre: string): VNode {
    const m = motif(lettre);
    // Portée la plus longue (2 ou 3 cases) : 5 × 5 pour un Personnage à courte portée, sinon 7 × 7
    const r = Math.max(2, ...[...m].map(k => k.split(',').map(Number)).map(([x, y]) => Math.max(Math.abs(x - 3), Math.abs(y - 3))).filter(d => d <= 3));
    const cases: VNode[] = [];
    for (let y = 3 + r; y >= 3 - r; y--) {
        for (let x = 3 - r; x <= 3 + r; x++) {
            const centre = x === 3 && y === 3;
            cases.push(h('i', { class: { centre, va: !centre && m.has(`${x},${y}`) } }));
        }
    }
    return h('span.dr-motif', { attrs: { 'aria-hidden': 'true' }, style: { '--n': String(2 * r + 1) } }, cases);
}

export class EcranDraft {
    private vnode: VNode | HTMLElement;
    private etat: EtatDraft | null = null;
    private file: EtatDraft[] = [];
    private enPause = false;
    private dejaVu = '';
    // Brouillon local
    private zones: number[][] = [];    // former : cartes du groupe 1, du groupe 2, de côté (case par case)
    private choixFormer: { zone: number, place: number } | null = null;
    private zonesPhase = '';
    private groupeChoisi: number | null = null;
    private placement: { pions: string[], arriere: string[] } | null = null;
    private selection: { rangee: 'pions' | 'arriere', i: number } | null = null;
    private envoye = false;
    // Partie classée : fin de l'étape en cours (heure locale), décomptée dans .dr-delai
    private finEtape = 0;
    private minuteur = 0;

    constructor(el: HTMLElement, private o: Options) {
        this.vnode = el;
        document.body.classList.add('en-draft');
        // Le décompte change le texte seul, sans redessiner l'écran (le brouillon local reste)
        this.minuteur = window.setInterval(() => {
            const el = document.querySelector('#draft-ecran .dr-delai');
            if (el) el.textContent = this.texteDelai();
            el?.classList.toggle('presse', this.finEtape - Date.now() < 10000);
        }, 500);
    }

    private texteDelai(): string {
        const s = Math.max(0, Math.ceil((this.finEtape - Date.now()) / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    recevoir(etat: EtatDraft) {
        if (etat.reste != null) this.finEtape = Date.now() + etat.reste * 1000;
        // Le temps restant n'est pas un nouvel état : sans lui dans la clé, pas de pause rejouée
        const { reste: _reste, ...sansDelai } = etat;
        const cle = JSON.stringify(sansDelai);
        if (cle === this.dejaVu) return;
        this.dejaVu = cle;
        this.file.push(etat);
        if (!this.enPause) this.suivant();
    }

    private suivant() {
        const etat = this.file.shift();
        if (!etat) return;
        if (etat.phase === 'FINI') {
            this.fermer();
            this.o.fini(etat);
            return;
        }
        const d = etat.dernier;
        const choixAdverse = d !== null && d.action === 'choisir' && (this.o.spectateur || d.couleur !== this.o.mycolor);
        const nouvelleEtape = !this.etat || this.etat.phase !== etat.phase;
        if (nouvelleEtape) {
            this.groupeChoisi = null;
            this.envoye = false;
            this.selection = null;
        }
        if (choixAdverse && nouvelleEtape) {
            this.enPause = true;
            this.etat = etat;
            this.dessiner(true);
            setTimeout(() => { this.enPause = false; this.dessiner(); this.suivant(); }, PAUSE_CHOIX);
            return;
        }
        this.etat = etat;
        this.dessiner();
        this.suivant();
    }

    fermer() {
        window.clearInterval(this.minuteur);
        document.body.classList.remove('en-draft');
        this.vnode = patch(this.vnode, h('div#draft-ecran'));
    }

    // ---------- Rendu ----------

    private dessiner(pause = false) {
        const e = this.etat!;
        this.vnode = patch(this.vnode, h('div#draft-ecran', [h('section.draft', pause ? this.vuePause(e) : this.vueEtape(e))]));
    }

    private moi(): Couleur { return this.o.spectateur ? 'white' : this.o.mycolor; }
    private aMoi(e: EtatDraft) { return !this.o.spectateur && e.acteur === this.o.mycolor; }

    private entete(e: EtatDraft, titre: string, texte: string): VNode[] {
        const etape = e.phase.startsWith('PIONS') ? 1 : e.phase.startsWith('CHAMPIONS') ? 2 : 3;
        const noms = ['Pions', 'Champions et Roi', 'Placement'];
        return [
            h('ol.dr-etapes', { attrs: { 'aria-label': `Draft, étape ${etape} sur 3` } }, noms.map((n, i) =>
                h('li', { class: { fait: i + 1 < etape, actif: i + 1 === etape } }, [h('i'), h('span', n)]))),
            h('h2.dr-titre', titre),
            h('p.dr-texte', texte),
            ...(e.reste != null && e.phase !== 'FINI' ? [h('p.dr-delai', { attrs: { 'aria-label': "Temps pour cette étape" } }, this.texteDelai())] : []),
        ];
    }

    private carte(e: EtatDraft, lettre: string, opts: { roi?: Saison, attrs?: Record<string, string>, on?: Record<string, () => void>, classes?: Record<string, boolean> } = {}): VNode {
        const face = this.moi();
        const visuel = opts.roi
            ? h('img.dr-roi', { attrs: { src: `${this.o.assetURL}/images/pieces/matatak/${face === 'white' ? 0 : 1}k${ROIS[opts.roi].image}.jpg`, alt: ROIS[opts.roi].nom } })
            : h('div.matatak', [h(`piece.${lettre}-piece.${face}`)]);
        const n = opts.roi ? 0 : (e.etoiles[lettre] ?? 0);
        const pied = opts.roi
            ? h('span.dr-nom', ROIS[opts.roi].nom)
            : h(`span.dr-etoiles.e${n}`, { attrs: { 'aria-label': `${n} étoile${n > 1 ? 's' : ''}` } }, '★'.repeat(n));
        const sel = opts.on ? 'button.dr-carte' : 'div.dr-carte';
        return h(sel, { class: opts.classes ?? {}, attrs: { ...(opts.on ? { type: 'button' } : {}), ...(opts.attrs ?? {}) }, on: opts.on ?? {} }, [visuel, pied, grilleDeplacements(lettre)]);
    }

    /** Cartes d'un type : Pions (indices dans e.pions) ou Champions (0-5) et Rois (6-7). */
    private carteIndex(e: EtatDraft, type: 'pions' | 'champions', i: number, opts: Parameters<EcranDraft['carte']>[2] = {}) {
        if (type === 'pions') return this.carte(e, e.pions[i], opts);
        return i >= 6 ? this.carte(e, 'k', { ...opts, roi: e.rois[i - 6] }) : this.carte(e, e.champions[i], opts);
    }

    private vueEtape(e: EtatDraft): VNode[] {
        const adv = this.o.nom(this.moi() === 'white' ? 'black' : 'white');
        const qui = e.acteur ? this.o.nom(e.acteur) : '';
        switch (e.phase) {
            case 'PIONS_FORMER':
            case 'CHAMPIONS_FORMER': {
                const type = e.phase === 'PIONS_FORMER' ? 'pions' : 'champions';
                if (this.aMoi(e)) return this.vueFormer(e, type, adv);
                return [
                    ...this.entete(e, `${qui} forme 2 groupes${type === 'pions' ? ' de Pions' : ' de Champions'}…`,
                        this.o.spectateur ? 'Le Draft est en cours.' : 'Vous choisirez ensuite le vôtre.'),
                    h('div.dr-reserve', this.indices(type).map(i => this.carteIndex(e, type, i))),
                    this.attente(),
                    this.resumeEquipes(e),
                ];
            }
            case 'PIONS_CHOISIR':
            case 'CHAMPIONS_CHOISIR': {
                const type = e.phase === 'PIONS_CHOISIR' ? 'pions' : 'champions';
                if (this.aMoi(e)) return this.vueChoisir(e, type, adv);
                return [
                    ...this.entete(e, `${qui} choisit ${type === 'pions' ? 'ses Pions' : 'ses Champions'}…`,
                        this.o.spectateur ? 'Le Draft est en cours.' : 'Vous aurez l\'autre groupe.'),
                    this.groupes(e, type, null),
                    this.attente(),
                    this.resumeEquipes(e),
                ];
            }
            case 'PLACEMENT':
                return this.vuePlacement(e, adv);
            default:
                return [];
        }
    }

    private indices(type: 'pions' | 'champions'): number[] {
        return type === 'pions' ? [0, 1, 2, 3, 4, 5, 6, 7] : [6, 0, 1, 2, 7, 3, 4, 5];
    }

    // --- Former : les groupes sont complets dès le départ ; toucher deux cartes de groupes
    // différents les échange (même geste que le placement). Un Roi s'échange avec l'autre Roi. ---
    private vueFormer(e: EtatDraft, type: 'pions' | 'champions', adv: string): VNode[] {
        if (this.zonesPhase !== e.phase) {
            this.zonesPhase = e.phase;
            this.zones = type === 'pions' ? [[0, 1, 2], [3, 4, 5], [6, 7]] : [[6, 0, 1], [7, 2, 3], [4, 5]];
            this.choixFormer = null;
        }
        const z = this.zones;
        const estRoi = (i: number) => type === 'champions' && i >= 6;
        const toucher = (zone: number, place: number) => {
            if (this.envoye) return;
            const c = this.choixFormer;
            if (c && c.zone !== zone && estRoi(z[c.zone][c.place]) === estRoi(z[zone][place])) {
                [z[c.zone][c.place], z[zone][place]] = [z[zone][place], z[c.zone][c.place]];
                this.choixFormer = null;
            } else {
                // Même carte : on la relâche ; sinon la sélection passe à la carte touchée
                this.choixFormer = c && c.zone === zone && c.place === place ? null : { zone, place };
            }
            this.dessiner();
        };
        const zone = (n: number, titre: string) => h('div.dr-zone', { class: { cote: n === 2 } }, [
            h('div.dr-zone-titre', [h('span', titre)]),
            h('div.dr-cartes', z[n].map((i, place) => this.carteIndex(e, type, i, {
                on: { click: () => toucher(n, place) },
                classes: { selection: this.choixFormer?.zone === n && this.choixFormer.place === place },
                attrs: { 'aria-label': 'Échanger' },
            }))),
        ]);
        const aide = this.choixFormer
            ? (estRoi(z[this.choixFormer.zone][this.choixFormer.place])
                ? 'Touchez l\'autre Roi pour les échanger.'
                : 'Touchez une carte d\'un autre groupe pour les échanger.')
            : `${adv} en choisira un, vous aurez l'autre. Touchez deux cartes pour les échanger.`;
        return [
            ...this.entete(e, type === 'pions' ? 'Formez 2 groupes de 3 Pions' : 'Formez 2 groupes : 2 Champions et 1 Roi', aide),
            h('div.dr-zones', [zone(0, 'Groupe 1'), zone(1, 'Groupe 2'), zone(2, 'De côté')]),
            h('button.mt-btn.mt-btn-or.dr-valider', {
                attrs: { type: 'button', disabled: this.envoye },
                on: { click: () => { this.envoye = true; this.choixFormer = null; this.o.envoyer({ action: 'former', groupes: [z[0], z[1]] }); this.dessiner(); } },
            }, this.envoye ? 'Envoyé…' : 'Valider mes groupes'),
            this.resumeEquipes(e),
        ];
    }

    // --- Choisir : toucher un groupe, puis le prendre ---
    private vueChoisir(e: EtatDraft, type: 'pions' | 'champions', adv: string): VNode[] {
        return [
            ...this.entete(e, type === 'pions' ? 'Choisissez vos Pions' : 'Choisissez vos Champions et votre Roi',
                `${adv} aura l'autre groupe. Les étoiles indiquent la Force.`),
            this.groupes(e, type, (g) => { if (!this.envoye) { this.groupeChoisi = g; this.dessiner(); } }),
            h('button.mt-btn.mt-btn-or.dr-valider', {
                attrs: { type: 'button', disabled: this.groupeChoisi === null || this.envoye },
                on: { click: () => { this.envoye = true; this.o.envoyer({ action: 'choisir', groupe: this.groupeChoisi }); this.dessiner(); } },
            }, this.envoye ? 'Envoyé…' : 'Prendre ce groupe'),
            this.resumeEquipes(e),
        ];
    }

    private groupes(e: EtatDraft, type: 'pions' | 'champions', choisir: ((g: number) => void) | null, pris?: { groupe: number, qui: string }): VNode {
        const groupes = e.groupes[type] ?? [];
        const utilises = groupes.flat();
        const cote = this.indices(type).filter(i => !utilises.includes(i));
        return h('div.dr-zones', [
            ...groupes.map((g, n) => {
                const choisi = pris ? pris.groupe === n : this.groupeChoisi === n;
                const contenu = [
                    h('div.dr-zone-titre', [
                        h('span', `Groupe ${n + 1}`),
                        pris ? h('small', pris.groupe === n ? pris.qui : 'Pour vous') : '',
                    ]),
                    h('div.dr-cartes', g.map(i => this.carteIndex(e, type, i))),
                ];
                return choisir
                    ? h('button.dr-zone.choix', { class: { choisi }, attrs: { type: 'button', 'aria-pressed': String(choisi) }, on: { click: () => choisir(n) } }, contenu)
                    : h('div.dr-zone', { class: { choisi, autre: !!pris && !choisi } }, contenu);
            }),
            cote.length ? h('div.dr-zone.cote', [
                h('div.dr-zone-titre', [h('span', 'De côté')]),
                h('div.dr-cartes', cote.map(i => this.carteIndex(e, type, i))),
            ]) : '',
        ]);
    }

    private vuePause(e: EtatDraft): VNode[] {
        const d = e.dernier!;
        const qui = this.o.nom(d.couleur);
        return [
            ...this.entete({ ...e, phase: d.type === 'pions' ? 'PIONS_CHOISIR' : 'CHAMPIONS_CHOISIR' },
                `${qui} prend ce groupe`, this.o.spectateur ? '' : 'Vous avez l\'autre.'),
            this.groupes(e, d.type, null, { groupe: d.groupe ?? 0, qui }),
        ];
    }

    // --- Placement : toucher deux Personnages d'une même rangée pour les échanger ---
    private vuePlacement(e: EtatDraft, adv: string): VNode[] {
        if (this.o.spectateur) {
            return [...this.entete(e, 'Les joueurs placent leur équipe…', ''), this.attente(), this.resumeEquipes(e)];
        }
        const equipe = e.equipes[this.o.mycolor]!;
        if (!this.placement) this.placement = { pions: [...equipe.pions], arriere: [...equipe.arriere] };
        const p = this.placement;
        const pret = e.pret[this.o.mycolor] || this.envoye;
        const toucher = (rangee: 'pions' | 'arriere', i: number) => {
            if (pret || (rangee === 'arriere' && p.arriere[i] === 'k')) return;
            const s = this.selection;
            if (s && s.rangee === rangee && s.i !== i) {
                const r = p[rangee];
                [r[s.i], r[i]] = [r[i], r[s.i]];
                this.selection = null;
            } else {
                this.selection = s && s.rangee === rangee && s.i === i ? null : { rangee, i };
            }
            this.dessiner();
        };
        const rangee = (nom: 'pions' | 'arriere') => h('div.dr-rangee', p[nom].map((l, i) => l === 'k'
            ? this.carte(e, 'k', { roi: equipe.roi, classes: { fixe: true } })
            : this.carte(e, l, {
                on: { click: () => toucher(nom, i) },
                classes: { selection: this.selection?.rangee === nom && this.selection.i === i },
                attrs: { 'aria-label': 'Échanger' },
            })));
        return [
            ...this.entete(e, pret ? `${adv} place son équipe…` : 'Placez votre équipe',
                pret ? 'La partie commence dès qu\'il est prêt.' : 'Touchez deux Personnages d\'une même rangée pour les échanger. Le Roi garde sa case.'),
            h('div.dr-placement', [rangee('pions'), rangee('arriere')]),
            pret ? this.attente() : h('button.mt-btn.mt-btn-or.dr-valider', {
                attrs: { type: 'button' },
                on: { click: () => { this.envoye = true; this.o.envoyer({ action: 'placer', pions: p.pions, arriere: p.arriere }); this.dessiner(); } },
            }, 'Prêt'),
        ];
    }

    private attente(): VNode {
        return h('div.dr-attente', { attrs: { role: 'status' } }, [h('i'), h('i'), h('i')]);
    }

    /** Ce que chacun a déjà pris. */
    private resumeEquipes(e: EtatDraft): VNode {
        if (e.choix.pions === null || !e.groupes.pions) return h('div.dr-resume');
        const g = e.groupes.pions;
        const pionsDe: Record<Couleur, number[]> = { black: g[e.choix.pions], white: g[1 - e.choix.pions] };
        const ligne = (c: Couleur) => h('div.dr-resume-ligne', [
            h('span', this.o.spectateur ? this.o.nom(c) : (c === this.o.mycolor ? 'Vous' : this.o.nom(c))),
            h('div.dr-cartes.petites', pionsDe[c].map(i => this.carteIndex(e, 'pions', i))),
        ]);
        const premier = this.moi();
        return h('div.dr-resume', [ligne(premier), ligne(premier === 'white' ? 'black' : 'white')]);
    }
}
