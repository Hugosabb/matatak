// Fenêtres au style du site, à la place de alert() et confirm() du navigateur (nettoyage du 11/11/2026) :
// une carte sombre, un bouton doré, rien d'autre. Styles « Fenêtres du site » de static/matatak-ui.css.

function creer(message: string, boutons: { texte: string; principal?: boolean; valeur: boolean }[], titre?: string): Promise<boolean> {
    return new Promise(resoudre => {
        const d = document.createElement('dialog');
        d.className = 'mt-fenetre';
        if (titre) {
            const t = document.createElement('h2');
            t.textContent = titre;
            d.appendChild(t);
        }
        const p = document.createElement('p');
        p.textContent = message;
        d.appendChild(p);
        const rangee = document.createElement('div');
        rangee.className = 'mt-fenetre-boutons';
        let fini = false;
        const fermer = (valeur: boolean) => {
            if (fini) return;
            fini = true;
            d.close();
            d.remove();
            resoudre(valeur);
        };
        for (const b of boutons) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = b.principal ? 'mt-btn mt-btn-or' : 'mt-fenetre-secondaire';
            el.textContent = b.texte;
            el.addEventListener('click', () => fermer(b.valeur));
            rangee.appendChild(el);
        }
        d.appendChild(rangee);
        // Échap ou toucher le fond : comme « Annuler »
        d.addEventListener('cancel', e => { e.preventDefault(); fermer(false); });
        d.addEventListener('click', e => { if (e.target === d) fermer(false); });
        document.body.appendChild(d);
        d.showModal();
        (rangee.querySelector('.mt-btn') as HTMLElement | null)?.focus();
    });
}

/** Remplace alert() : un message et « OK ». */
export function avertir(message: string, titre?: string): Promise<void> {
    return creer(message, [{ texte: 'OK', principal: true, valeur: true }], titre).then(() => undefined);
}

/** Remplace confirm() : vrai si le joueur touche le bouton doré. */
export function confirmer(message: string, oui = 'Oui', non = 'Annuler', titre?: string): Promise<boolean> {
    return creer(message, [{ texte: oui, principal: true, valeur: true }, { texte: non, valeur: false }], titre);
}
