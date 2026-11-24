// ESSAI de page de précommande simple (/precommande/simple, Hugo 24/11) : une offre, un bouton, un panneau pour la
// livraison et le paiement. Le serveur recalcule tout (server/boutique.py) : on n'envoie que la quantité, le mode de
// livraison et le relais choisi.
(() => {
    const prix = JSON.parse(document.getElementById('pc-prix').textContent);
    const liv = prix.livraison;
    const panneau = document.querySelector('.ps-panneau');
    const sortie = panneau.querySelector('output');
    const erreur = panneau.querySelector('.erreur');
    const blocRelais = panneau.querySelector('.choix-relais');
    let n = 1, mode = 'relais', relais = null;
    const euros = (m) => {
        const r = Math.round(m * 100) / 100;
        return (Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',')) + ' €';
    };
    function afficher() {
        sortie.textContent = n;
        panneau.querySelector('.moins').disabled = n <= 1;
        const articles = n * prix.jeu;
        const port = mode === 'retrait' || articles >= liv.offerte_des ? 0 : liv.prix;
        panneau.querySelector('.ps-port').textContent = port ? euros(port) : 'offert';
        panneau.querySelector('.ps-total b').textContent = euros(articles + port);
        if (blocRelais) blocRelais.hidden = mode !== 'relais';
    }
    document.querySelector('.ps-commander').addEventListener('click', () => { erreur.hidden = true; afficher(); panneau.showModal(); });
    panneau.querySelector('.fermer').addEventListener('click', () => panneau.close());
    panneau.addEventListener('click', (e) => { if (e.target === panneau) panneau.close(); });
    panneau.querySelector('.moins').addEventListener('click', () => { n = Math.max(1, n - 1); afficher(); });
    panneau.querySelector('.plus').addEventListener('click', () => { n = Math.min(20, n + 1); afficher(); });
    panneau.querySelectorAll('input[name="livraison"]').forEach((r) => r.addEventListener('change', () => { mode = r.value; afficher(); }));

    // point relais : même recherche que la page complète (GET /precommande/relais)
    if (blocRelais) {
        const form = blocRelais.querySelector('form'), liste = blocRelais.querySelector('.liste-relais');
        const message = blocRelais.querySelector('.relais-message'), choisi = blocRelais.querySelector('.relais-choisi');
        const majChoix = () => {
            choisi.hidden = !relais; form.hidden = !!relais; liste.hidden = !!relais;
            if (relais) { choisi.querySelector('span').textContent = `${relais.nom}, ${relais.adresse}, ${relais.code_postal} ${relais.ville}`; message.textContent = ''; }
        };
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cp = form.cp.value.trim();
            if (!/^\d{5}$/.test(cp)) { message.textContent = 'Entrez un code postal à 5 chiffres.'; return; }
            message.textContent = 'Recherche des relais…'; liste.innerHTML = '';
            try {
                const rep = await fetch(`/precommande/relais?cp=${cp}`);
                const d = await rep.json().catch(() => ({}));
                if (!rep.ok || !d.relais) { message.textContent = d.erreur || 'Recherche impossible pour le moment.'; return; }
                message.textContent = d.relais.length ? 'Choisissez votre relais :' : 'Aucun relais trouvé : essayez un code postal voisin.';
                d.relais.forEach((r) => {
                    const b = document.createElement('button');
                    b.type = 'button'; b.className = 'relais';
                    b.innerHTML = '<b></b><span class="adr"></span>';
                    b.querySelector('b').textContent = r.nom;
                    b.querySelector('.adr').textContent = `${r.adresse}, ${r.code_postal} ${r.ville}`;
                    b.addEventListener('click', () => { relais = { id: r.id, nom: r.nom, adresse: r.adresse, code_postal: r.code_postal, ville: r.ville }; majChoix(); });
                    const li = document.createElement('li'); li.append(b); liste.append(li);
                });
            } catch (er) { message.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.'; }
        });
        choisi.querySelector('.changer-relais').addEventListener('click', () => { relais = null; majChoix(); });
        majChoix();
    }

    const payer = panneau.querySelector('.ps-payer');
    payer.addEventListener('click', async () => {
        erreur.hidden = true;
        if (blocRelais && mode === 'relais' && !relais) { erreur.textContent = "Choisissez d'abord votre point relais."; erreur.hidden = false; return; }
        payer.disabled = true;
        try {
            const rep = await fetch('/precommande/paiement', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ panier: [{ cle: 'jeu', n }], livraison: mode, relais: mode === 'relais' ? relais : null }),
            });
            const d = await rep.json().catch(() => ({}));
            if (rep.ok && d.url) { window.location.assign(d.url); return; }
            erreur.textContent = d.erreur || 'Le paiement est indisponible pour le moment.';
        } catch (er) { erreur.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.'; }
        erreur.hidden = false;
        payer.disabled = false;
    });

    // en-tête caché quand on descend, de retour quand on remonte (comme la page complète)
    let yAvant = window.scrollY, cumul = 0;
    window.addEventListener('scroll', () => {
        const y = window.scrollY, d = y - yAvant; yAvant = y;
        cumul = (cumul > 0) === (d > 0) ? cumul + d : d;
        if (y < 80) document.body.classList.remove('entete-cache');
        else if (cumul > 24) document.body.classList.add('entete-cache');
        else if (cumul < -12) document.body.classList.remove('entete-cache');
    }, { passive: true });
})();
