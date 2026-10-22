// « Garder la même équipe » : la position de départ de la dernière partie est mémorisée sur l'appareil,
// puis renvoyée au serveur (qui la valide avec pyffish) pour rejouer avec les mêmes Personnages.

export interface EquipeMemorisee {
    fen: string;
    color: 'w' | 'b'; // la couleur jouée quand la position a été mémorisée
}

const cle = (variant: string) => `jouer_equipe_${variant}`;

// Placement complet (deux Rois) : exclut le Draft, dont la position de départ est un plateau vide.
function placementComplet(fen: string): boolean {
    const placement = fen.split(' ')[0].replace(/\[.*\]$/, '');
    return placement.includes('K') && placement.includes('k');
}

export function memoriserEquipe(variant: string, fen: string, color: 'white' | 'black') {
    if (!variant.startsWith('matatak') || !fen || !placementComplet(fen)) return;
    try {
        localStorage.setItem(cle(variant), JSON.stringify({ fen, color: color === 'white' ? 'w' : 'b' }));
    } catch { /* navigation privée */ }
}

export function equipeMemorisee(variant: string): EquipeMemorisee | null {
    try {
        const v = JSON.parse(localStorage.getItem(cle(variant)) ?? 'null');
        if (v && typeof v.fen === 'string' && (v.color === 'w' || v.color === 'b') && placementComplet(v.fen)) return v;
    } catch { /* rien de mémorisé */ }
    return null;
}

const echangerCasse = (t: string) => t.replace(/[a-zA-Z]/g, c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());

// Demi-tour du plateau en échangeant les camps : chaque joueur retrouve sa formation,
// vue depuis l'autre côté. Sert quand on rejoue son équipe avec l'autre couleur.
export function tournerFen(fen: string): string {
    const champs = fen.split(' ');
    const reserve = (champs[0].match(/\[.*\]$/) ?? [''])[0];
    const rangees = champs[0].slice(0, champs[0].length - reserve.length).split('/');
    const tournees = rangees.reverse().map(rangee => {
        const cases: string[] = [];
        for (const m of rangee.matchAll(/\d+|[+]?[a-zA-Z]~?/g)) {
            const t = m[0];
            if (/^\d+$/.test(t)) for (let i = 0; i < Number(t); i++) cases.push('1');
            else cases.push(echangerCasse(t));
        }
        // On recompacte les cases vides
        return cases.reverse().join('').replace(/1+/g, vides => String(vides.length));
    });
    champs[0] = tournees.join('/') + echangerCasse(reserve);
    return champs.join(' ');
}

// Position à envoyer pour jouer `couleur` avec son équipe mémorisée.
export function fenPourCouleur(equipe: EquipeMemorisee, couleur: 'w' | 'b'): string {
    return equipe.color === couleur ? equipe.fen : tournerFen(equipe.fen);
}
