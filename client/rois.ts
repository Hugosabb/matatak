// Les 4 Rois de MATATAK : adversaires du mode Solo (un Roi par palier de 5 niveaux) et Roi
// affiché sur le plateau, assorti à l'équipe de chaque camp.

export type Saison = 'printemps' | 'ete' | 'automne' | 'hiver';

// Image du Roi : static/images/pieces/matatak/{0|1}k{n}.jpg (0 = face claire, 1 = face sombre)
// Répliques des cartes (validées par Hugo, motiontak/assets/cartes/cartes.json)
export const ROIS: Record<Saison, { nom: string, image: number, titre: string, replique: string }> = {
    printemps: { nom: 'MOJO', image: 0, titre: 'Roi du Printemps', replique: '« Vas-y, épate-moi. »' },
    ete: { nom: 'AZAR', image: 1, titre: "Roi de l'Été", replique: '« Pas de casse ? Pas de Mananas. »' },
    automne: { nom: 'SHANS', image: 2, titre: "Roi de l'Automne", replique: '« La chance sourit aux audacieuses. »' },
    hiver: { nom: 'KARMA', image: 3, titre: "Roi de l'Hiver", replique: '« La vengeance est un plat qui se mange glacé. »' },
};

// Saison du Personnage affiché pour chaque lettre (piece-css/matatak/matatak.css)
const SAISON_LETTRE: Record<string, Saison> = {
    a: 'printemps', b: 'automne', c: 'printemps', d: 'hiver', e: 'automne', f: 'ete', g: 'hiver',
    h: 'printemps', i: 'automne', j: 'ete', l: 'hiver', m: 'printemps', n: 'automne', o: 'ete',
    p: 'printemps', q: 'automne', r: 'ete', s: 'printemps', t: 'automne', w: 'hiver', x: 'ete',
    y: 'printemps', z: 'hiver',
};

/** Roi adverse en Solo : l'équipe la plus forte (Été) face au moteur le plus faible, et l'inverse. */
export function saisonDuNiveau(niveau: number): Saison {
    return niveau <= 5 ? 'ete' : niveau <= 10 ? 'automne' : niveau <= 15 ? 'hiver' : 'printemps';
}

export function roiDuNiveau(niveau: number): string {
    return ROIS[saisonDuNiveau(niveau)].nom;
}

function hachage(texte: string): number {
    let h = 0;
    for (let i = 0; i < texte.length; i++) h = (h * 31 + texte.charCodeAt(i)) >>> 0;
    return h;
}

/** Saison la plus présente dans l'équipe d'un camp (Mini : celle de l'équipe de départ).
 *  À égalité, un tirage fixé par la graine (l'id de la partie) : le même sur les deux écrans. */
export function saisonDuCamp(fen: string, couleur: 'white' | 'black', graine: string): Saison {
    const compte: Record<Saison, number> = { printemps: 0, ete: 0, automne: 0, hiver: 0 };
    for (const c of fen.split(' ')[0]) {
        const blanc = c >= 'A' && c <= 'Z';
        if (blanc !== (couleur === 'white')) continue;
        const saison = SAISON_LETTRE[c.toLowerCase()];
        if (saison) compte[saison]++;
    }
    const max = Math.max(...Object.values(compte));
    const egales = (Object.keys(compte) as Saison[]).filter(s => compte[s] === max);
    return egales[hachage(graine + couleur) % egales.length];
}

/** Remplace l'image du Roi de chaque camp pour cette page. */
export function appliquerRois(assetURL: string, blanc: Saison, noir: Saison) {
    const dossier = `${assetURL}/images/pieces/matatak/`;
    let style = document.getElementById('rois-partie');
    if (!style) {
        style = document.createElement('style');
        style.id = 'rois-partie';
        document.head.appendChild(style);
    }
    style.textContent =
        `.matatak piece.k-piece.white::before { background-image: url('${dossier}0k${ROIS[blanc].image}.jpg') !important; }\n` +
        `.matatak piece.k-piece.black::before { background-image: url('${dossier}1k${ROIS[noir].image}.jpg') !important; }`;
}
