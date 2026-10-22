// Fenêtre « Installer l'appli » : bouton natif quand le navigateur le permet, sinon les gestes à faire
// selon l'appareil et le navigateur (détectés par static/js/installer.js).

interface Installeur {
    installee(): boolean;
    plateforme(): { appareil: 'ios' | 'android' | 'ordinateur'; navigateur: string };
    peutInviter(): boolean;
    inviter(): Promise<'acceptee' | 'refusee' | 'indisponible'>;
    surChangement(f: () => void): () => void;
}

export function installeur(): Installeur | null {
    return (window as unknown as { matatakInstaller?: Installeur }).matatakInstaller ?? null;
}

interface Guide { titre: string; etapes: string[] }

const GUIDES: Record<string, Guide> = {
    'ios-safari': { titre: 'iPhone et iPad · Safari', etapes: [
        'Touchez le bouton Partager (le carré avec une flèche vers le haut) : en bas de l\'écran sur iPhone, en haut sur iPad.',
        'Faites défiler et touchez « Sur l\'écran d\'accueil ».',
        'Touchez « Ajouter » : l\'icône MATATAK apparaît sur votre écran d\'accueil.',
    ] },
    'ios-autre': { titre: 'iPhone et iPad · Chrome, Edge ou Firefox', etapes: [
        'Touchez le bouton Partager, dans la barre d\'adresse (Chrome, Edge) ou dans le menu ≡ (Firefox).',
        'Touchez « Sur l\'écran d\'accueil ».',
        'Touchez « Ajouter ». Si l\'option manque, ouvrez matatak.org dans Safari.',
    ] },
    'android-chrome': { titre: 'Android · Chrome', etapes: [
        'Touchez le menu ⋮ en haut à droite.',
        'Touchez « Installer l\'application » (ou « Ajouter à l\'écran d\'accueil »).',
        'Confirmez avec « Installer ».',
    ] },
    'android-samsung': { titre: 'Android · Samsung Internet', etapes: [
        'Touchez le menu ≡ en bas à droite.',
        'Touchez « Ajouter page à », puis « Écran d\'accueil ».',
        'Confirmez avec « Ajouter ».',
    ] },
    'android-firefox': { titre: 'Android · Firefox', etapes: [
        'Touchez le menu ⋮.',
        'Touchez « Installer » (ou « Ajouter à l\'écran d\'accueil »).',
        'Confirmez.',
    ] },
    'ordinateur-chrome': { titre: 'Ordinateur · Chrome ou Edge', etapes: [
        'Cliquez sur l\'icône d\'installation à droite de la barre d\'adresse (un écran avec une flèche).',
        'Sinon, menu ⋮ puis « Installer MATATAK » (Chrome) ou « Applications », puis « Installer ce site en tant qu\'application » (Edge).',
        'Confirmez avec « Installer » : MATATAK s\'ouvre dans sa propre fenêtre.',
    ] },
    'ordinateur-safari': { titre: 'Mac · Safari', etapes: [
        'Menu Fichier, puis « Ajouter au Dock » (macOS Sonoma ou plus récent).',
        'Confirmez avec « Ajouter ».',
    ] },
    'ordinateur-firefox': { titre: 'Ordinateur · Firefox', etapes: [
        'Firefox sur ordinateur n\'installe pas les applis web.',
        'Ouvrez matatak.org dans Chrome ou Edge pour l\'installer, ou continuez à jouer ici.',
    ] },
};

function guideDetecte(i: Installeur): string {
    const { appareil, navigateur } = i.plateforme();
    if (appareil === 'ios') return navigateur === 'safari' ? 'ios-safari' : 'ios-autre';
    if (appareil === 'android') return navigateur === 'samsung' ? 'android-samsung' : navigateur === 'firefox' ? 'android-firefox' : 'android-chrome';
    if (navigateur === 'safari') return 'ordinateur-safari';
    if (navigateur === 'firefox') return 'ordinateur-firefox';
    return 'ordinateur-chrome';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, texte?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texte !== undefined) e.textContent = texte;
    return e;
}

function listeEtapes(g: Guide): HTMLElement {
    const ol = el('ol', 'inst-etapes');
    g.etapes.forEach(t => ol.appendChild(el('li', '', t)));
    return ol;
}

export function ouvrirInstallation() {
    const i = installeur();
    if (!i) return;
    document.getElementById('installer-dialog')?.remove();
    const d = el('dialog', 'inst-dialog');
    d.id = 'installer-dialog';
    d.setAttribute('aria-labelledby', 'inst-titre');

    const fermer = el('button', 'inst-fermer', '×');
    fermer.type = 'button';
    fermer.setAttribute('aria-label', 'Fermer');
    fermer.onclick = () => d.close();

    const titre = el('h2', 'inst-titre', 'Installer MATATAK');
    titre.id = 'inst-titre';
    const intro = el('p', 'inst-intro', 'Jouez en plein écran, comme une appli, d\'un simple toucher depuis votre écran d\'accueil. Les mises à jour arrivent toutes seules.');
    d.append(fermer, titre, intro);

    const cle = guideDetecte(i);
    if (i.peutInviter()) {
        const b = el('button', 'mt-btn mt-btn-or mt-btn-large', 'Installer l\'appli');
        b.type = 'button';
        b.onclick = async () => {
            const r = await i.inviter();
            if (r === 'acceptee') { d.close(); }
        };
        d.append(b, el('p', 'inst-note', 'Votre navigateur va vous demander de confirmer.'));
    } else {
        d.append(el('h3', 'inst-sous-titre', GUIDES[cle].titre), listeEtapes(GUIDES[cle]));
    }

    const autres = el('details', 'inst-autres');
    autres.appendChild(el('summary', '', 'Un autre appareil ou navigateur ?'));
    Object.entries(GUIDES).filter(([k]) => k !== cle).forEach(([, g]) => {
        autres.append(el('h3', 'inst-sous-titre', g.titre), listeEtapes(g));
    });
    d.appendChild(autres);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => d.remove());
    document.body.appendChild(d);
    d.showModal();
}
