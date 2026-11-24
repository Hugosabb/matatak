// Page de précommande : panier en mémoire (gardé le temps de l'onglet, pour le retrouver au retour de Stripe).
// Lignes = packs à prix réduit (jeu + 4 extensions, jeu + 2 extensions au choix), jeu seul, extensions à l'unité
// sans remise (choix d'Hugo, 20/11). Prix lus dans le même fichier que le serveur (server/views/precommande.py) ;
// le serveur recalcule tout (server/boutique.py) : le navigateur n'envoie que des clés et des quantités.
(() => {
    const prix = JSON.parse(document.getElementById('pc-prix').textContent);
    const liv = prix.livraison;
    const SAISONS = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' };
    const ORDRE = Object.keys(SAISONS);
    const MAX = 20; // comme N_MAX côté serveur
    const MEMOIRE = 'matatak_precommande';
    const MEMOIRE_MODE = 'matatak_precommande_livraison';
    const lignes = document.querySelector('.lignes');
    // offre de lancement : le bandeau n'existe que si elle court encore ; le code obtenu est gardé dans le navigateur
    const bandeau = document.querySelector('.pc-code');
    const MEMOIRE_CODE = 'matatak_code_lancement';
    let code = '';
    try { code = bandeau ? (localStorage.getItem(MEMOIRE_CODE) || '') : ''; } catch (e) { /* stockage refusé */ }
    const sachet = (s) => `${lignes.dataset.sachets}/sachet-${s}.webp`;

    // panier : clé -> quantité, dans l'ordre d'ajout
    const panier = new Map();
    try {
        for (const [cle, n] of JSON.parse(sessionStorage.getItem(MEMOIRE) || '[]')) panier.set(cle, n);
    } catch (e) { /* stockage refusé : panier vide */ }

    // code promo appliqué dans le panier (vérifié par le serveur) : { code, remise par jeu seul }
    const MEMOIRE_APPLIQUE = 'matatak_precommande_code';
    let applique = null;
    try { applique = JSON.parse(sessionStorage.getItem(MEMOIRE_APPLIQUE) || 'null'); } catch (e) { applique = null; }

    // ce qu'est chaque clé : nom, prix unitaire, économie unitaire, image
    function article(cle) {
        if (cle === 'jeu') return { nom: "L'Essentiel : le jeu", prix: prix.jeu, eco: 0, img: lignes.dataset.boite };
        if (cle === 'quatre') return {
            nom: "L'Intégrale : le jeu + les 4 extensions", prix: prix.packs.jeu_quatre,
            eco: prix.jeu + 4 * prix.extension - prix.packs.jeu_quatre, img: lignes.dataset.boite, sachets: ORDRE,
        };
        if (cle.startsWith('deux:')) {
            const [a, b] = cle.slice(5).split(',');
            return {
                nom: `À la carte : le jeu + ${SAISONS[a]} et ${SAISONS[b]}`, prix: prix.packs.jeu_deux,
                eco: prix.jeu + 2 * prix.extension - prix.packs.jeu_deux, img: lignes.dataset.boite, sachets: [a, b],
            };
        }
        const s = cle.slice(4); // ext:<saison>
        return { nom: `Extension ${SAISONS[s]}`, prix: prix.extension, eco: 0, img: sachet(s) };
    }
    // les extensions sortent plus tard (Hugo, 24/11) : tant que extensions_dispo est faux, seul le jeu se commande
    const extDispo = prix.extensions_dispo !== false;
    const connue = (cle) => {
        if (cle === 'jeu') return true;
        if (!extDispo) return false;
        if (cle === 'quatre') return true;
        if (cle.startsWith('ext:')) return cle.slice(4) in SAISONS;
        if (cle.startsWith('deux:')) return cle.slice(5).split(',').every((s) => s in SAISONS);
        return false;
    };
    for (const cle of [...panier.keys()]) if (!connue(cle)) panier.delete(cle);

    // mode de livraison : point relais (payant sous le seuil) ou retrait gratuit en boutique
    const radios = [...document.querySelectorAll('input[name="livraison"]')];
    let mode = 'relais';
    try { mode = sessionStorage.getItem(MEMOIRE_MODE) || 'relais'; } catch (e) { /* rien */ }
    if (!radios.some((r) => r.value === mode)) mode = 'relais';
    radios.forEach((r) => {
        r.checked = r.value === mode;
        r.addEventListener('change', () => {
            mode = r.value;
            try { sessionStorage.setItem(MEMOIRE_MODE, mode); } catch (e) { /* rien */ }
            afficher();
        });
    });

    // point relais choisi avant le paiement (Hugo, 24/11) : cherché par notre serveur, gardé le temps de l'onglet
    const blocRelais = document.querySelector('.choix-relais');
    const MEMOIRE_RELAIS = 'matatak_precommande_relais';
    let relais = null;
    try { relais = JSON.parse(sessionStorage.getItem(MEMOIRE_RELAIS) || 'null'); } catch (e) { relais = null; }
    function majRelais() {
        if (!blocRelais) return;
        const choisi = blocRelais.querySelector('.relais-choisi');
        const form = blocRelais.querySelector('.chercher-relais');
        choisi.hidden = !relais;
        form.hidden = !!relais;
        blocRelais.querySelector('.liste-relais').hidden = !!relais;
        if (relais) {
            choisi.querySelector('span').textContent = `Votre relais : ${relais.nom}, ${relais.adresse}, ${relais.code_postal} ${relais.ville}`;
            blocRelais.querySelector('.relais-message').textContent = '';
        }
    }
    if (blocRelais) {
        const form = blocRelais.querySelector('.chercher-relais');
        const liste = blocRelais.querySelector('.liste-relais');
        const message = blocRelais.querySelector('.relais-message');
        const km = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cp = form.cp.value.trim();
            if (!/^\d{5}$/.test(cp)) { message.textContent = 'Entrez un code postal à 5 chiffres.'; return; }
            message.textContent = 'Recherche des relais…';
            liste.innerHTML = '';
            try {
                const rep = await fetch(`/precommande/relais?cp=${encodeURIComponent(cp)}&ville=${encodeURIComponent(form.ville.value.trim())}`);
                const d = await rep.json().catch(() => ({}));
                if (!rep.ok) { message.textContent = d.erreur || 'Recherche impossible pour le moment.'; return; }
                if (!d.relais.length) { message.textContent = 'Aucun relais trouvé près de chez vous : essayez une ville voisine.'; return; }
                message.textContent = d.exemple ? 'Relais d\'exemple (serveur de test) : choisissez le vôtre.' : 'Choisissez votre relais :';
                d.relais.forEach((r) => {
                    const li = document.createElement('li');
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'relais';
                    // jours qui se suivent avec les mêmes horaires regroupés : « lun.–sam. 9:00–12:30 · 14:00–19:00 »
                    const groupes = [];
                    (r.horaires || []).forEach(([j, h]) => {
                        const g = groupes[groupes.length - 1];
                        if (g && g.h === h) g.fin = j; else groupes.push({ debut: j, fin: j, h });
                    });
                    const court = (j) => j.slice(0, 3) + '.';
                    const horaires = groupes.filter((g) => g.h).map((g) => `${court(g.debut)}${g.fin !== g.debut ? '–' + court(g.fin) : ''} ${g.h}`).join(' ; ');
                    b.innerHTML = '<b></b><span class="adr"></span><span class="dist"></span><small></small>';
                    b.querySelector('b').textContent = r.nom;
                    b.querySelector('.adr').textContent = `${r.adresse}, ${r.code_postal} ${r.ville}`;
                    b.querySelector('.dist').textContent = km(r.distance);
                    b.querySelector('small').textContent = horaires;
                    b.addEventListener('click', () => {
                        relais = { id: r.id, nom: r.nom, adresse: r.adresse, code_postal: r.code_postal, ville: r.ville };
                        try { sessionStorage.setItem(MEMOIRE_RELAIS, JSON.stringify(relais)); } catch (er) { /* rien */ }
                        majRelais();
                    });
                    li.append(b);
                    liste.append(li);
                });
            } catch (er) {
                message.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.';
            }
        });
        blocRelais.querySelector('.changer-relais').addEventListener('click', () => {
            relais = null;
            try { sessionStorage.removeItem(MEMOIRE_RELAIS); } catch (er) { /* rien */ }
            majRelais();
            form.cp.focus();
        });
        majRelais();
    }

    const euros = (m) => {
        const r = Math.round(m * 100) / 100;
        return (Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',')) + ' €';
    };
    const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    const compteur = (cle, nom) => `<div class="compteur" data-cle="${cle}">
        <button type="button" class="moins" aria-label="Retirer : ${nom}">${svg('M6 12h12')}</button>
        <output aria-live="polite">0</output>
        <button type="button" class="plus" aria-label="Ajouter : ${nom}">${svg('M6 12h12M12 6v12')}</button></div>`;

    function afficher() {
        try { sessionStorage.setItem(MEMOIRE, JSON.stringify([...panier])); } catch (e) { /* rien */ }
        // lignes du panier
        lignes.replaceChildren();
        let articles = 0, eco = 0, nb = 0;
        for (const [cle, n] of panier) {
            const a = article(cle);
            articles += n * a.prix;
            eco += n * a.eco;
            nb += n;
            const l = document.createElement('div');
            l.className = 'ligne';
            // vignette : la boîte, et pour un pack ses sachets devant (les Saisons choisies)
            const sachets = (a.sachets || []).map((s, k) => `<img class="v-sachet n${(a.sachets || []).length} k${k}" src="${sachet(s)}" alt="" width="400" height="651">`).join('');
            l.innerHTML = `<span class="vignette${a.sachets ? ' pack' : ''}"><img class="v-principale" src="${a.img}" alt="" width="360" height="453">${sachets}</span><span class="nom"></span>${compteur(cle, a.nom)}<span class="montant">${euros(n * a.prix)}</span>`;
            l.querySelector('.nom').textContent = a.nom;
            lignes.append(l);
        }
        const vide = panier.size === 0;
        const retrait = mode === 'retrait';
        if (blocRelais) blocRelais.hidden = retrait || panier.size === 0;
        const offert = articles >= liv.offerte_des;
        const port = vide || offert || retrait ? 0 : liv.prix;

        document.querySelectorAll('.compteur').forEach((c) => {
            const n = panier.get(c.dataset.cle) || 0;
            c.querySelector('output').textContent = n;
            c.querySelector('.moins').disabled = n === 0;
            c.querySelector('.plus').disabled = n >= MAX;
            c.classList.toggle('actif', n > 0);
        });

        const carte = document.querySelector('.carte-panier');
        carte.classList.toggle('est-vide', vide);
        carte.querySelector('.eco-total').textContent = eco > 0 ? `Avec les packs, vous économisez ${euros(eco)}` : '';
        carte.querySelector('.sous-total span:last-child').textContent = euros(articles);
        const libelle = carte.querySelector('.port span:first-child');
        libelle.textContent = retrait ? libelle.dataset.retrait : libelle.dataset.relais;
        carte.querySelector('.port span:last-child').textContent = retrait ? 'Gratuit' : offert ? 'Offerte' : euros(port);
        carte.querySelector('.port').classList.toggle('offerte', (offert || retrait) && !vide);
        const prixRelais = carte.querySelector('[data-prix-relais]');
        if (prixRelais) {
            prixRelais.textContent = offert ? 'Offerte' : euros(liv.prix);
            prixRelais.classList.toggle('gratuit', offert);
        }
        // code promo : une remise sur chaque Essentiel, le jeu seul (le serveur refait le calcul)
        const nJeux = panier.get('jeu') || 0;
        const remise = applique ? applique.remise * nJeux : 0;
        const ligneRemise = carte.querySelector('.remise');
        ligneRemise.hidden = remise === 0;
        ligneRemise.firstElementChild.textContent = `Code ${applique ? applique.code : ''} (${euros(applique ? applique.remise : 0)} × ${nJeux} Essentiel)`;
        ligneRemise.lastElementChild.textContent = '−' + euros(remise);
        const zoneCode = document.querySelector('.code-promo');
        zoneCode.hidden = Boolean(applique);
        const blocApplique = document.querySelector('.code-applique');
        blocApplique.hidden = !applique;
        if (applique) {
            blocApplique.querySelector('b').textContent = applique.code;
            blocApplique.classList.toggle('sans-effet', nJeux === 0);
        }
        carte.querySelector('.total span:last-child').textContent = euros(articles + port - remise);

        // livraison offerte : dit ce qu'on perdrait (aversion à la perte), pas ce qu'on gagne
        const seuil = carte.querySelector('.seuil');
        seuil.hidden = vide || retrait;
        seuil.querySelector('p').textContent = offert
            ? 'La livraison vous est offerte.'
            : `Plus que ${euros(liv.offerte_des - articles)} pour ne pas payer la livraison.`;
        seuil.querySelector('.jauge i').style.transform = `scaleX(${Math.min(1, articles / liv.offerte_des)})`;
        seuil.classList.toggle('atteint', offert);

        const pastille = document.querySelector('.nb-panier');
        pastille.hidden = vide;
        pastille.textContent = nb;

        const barre = document.getElementById('pc-barre');
        barre.classList.toggle('visible', !vide);
        barre.querySelector('.barre-total').textContent = euros(articles + port - remise);

        // les offres déjà dans le panier sont marquées (cadre or, « Dans le panier »)
        document.querySelectorAll('.formule').forEach((f) => {
            const o = f.dataset.offre;
            f.classList.toggle('choisie', o === 'deux' ? [...panier.keys()].some((c) => c.startsWith('deux:')) : panier.has(o));
        });
    }

    function changer(cle, delta) {
        const n = Math.max(0, Math.min(MAX, (panier.get(cle) || 0) + delta));
        if (n === 0) panier.delete(cle); else panier.set(cle, n);
        afficher();
    }

    // compteurs (extensions à l'unité et lignes du panier)
    document.addEventListener('click', (e) => {
        const bouton = e.target.closest('.compteur button');
        if (bouton) changer(bouton.closest('.compteur').dataset.cle, bouton.classList.contains('plus') ? 1 : -1);
    });

    // pack « 2 extensions » : toujours 2 Saisons cochées ; une 3e décoche la plus ancienne ; le visuel suit
    const choix = document.querySelector('.choix-saisons');
    const ordre = [...choix.querySelectorAll('input:checked')].map((i) => i.value);
    const sachetsDeux = document.querySelectorAll('.formule-deux .sachet');
    const paire = () => [...ordre].sort((x, y) => ORDRE.indexOf(x) - ORDRE.indexOf(y));
    choix.addEventListener('change', (e) => {
        const i = e.target;
        if (i.checked) {
            ordre.push(i.value);
            if (ordre.length > 2) choix.querySelector(`input[value="${ordre.shift()}"]`).checked = false;
        } else {
            i.checked = true; // on ne descend pas sous 2 : il faut en cocher une autre
        }
        paire().forEach((s, k) => { sachetsDeux[k].src = sachet(s); });
    });

    // boutons « Ajouter au panier » des offres
    document.querySelectorAll('.formule .ajouter').forEach((b) => {
        const texte = b.textContent;
        b.addEventListener('click', () => {
            const formule = b.closest('.formule');
            const offre = formule.dataset.offre;
            changer(offre === 'deux' ? 'deux:' + paire().join(',') : offre, 1);
            // petit rebond de l'offre : on voit qu'elle est prise
            formule.classList.remove('ajout');
            void formule.offsetWidth;
            formule.classList.add('ajout');
            b.classList.add('ajoute');
            b.textContent = 'Ajouté au panier';
            clearTimeout(b._minuterie);
            b._minuterie = setTimeout(() => { b.classList.remove('ajoute'); b.textContent = texte; }, 1600);
        });
    });

    // paiement : le serveur crée la session Stripe Checkout et renvoie son adresse
    const payer = document.querySelector('.payer');
    const erreur = document.querySelector('.carte-panier .erreur');
    payer.addEventListener('click', async () => {
        erreur.hidden = true;
        payer.disabled = true;
        const texte = payer.textContent;
        payer.textContent = 'Un instant…';
        try {
            const rep = await fetch('/precommande/paiement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ panier: [...panier].map(([cle, n]) => ({ cle, n })), livraison: mode, code: applique ? applique.code : '', relais: mode === 'relais' ? relais : null }),
            });
            const donnees = await rep.json().catch(() => ({}));
            if (rep.ok && donnees.url) {
                window.location.assign(donnees.url);
                return;
            }
            if (donnees.relais_manquant && blocRelais) {
                blocRelais.scrollIntoView({ behavior: 'smooth', block: 'center' });
                blocRelais.querySelector('.relais-message').textContent = 'Choisissez d\'abord votre point relais.';
                blocRelais.querySelector('.chercher-relais').cp.focus();
            }
            if (donnees.pas_dispo) { // panier gardé d'avant : on n'y laisse que le jeu
                for (const cle of [...panier.keys()]) if (!connue(cle)) panier.delete(cle);
                afficher();
            }
            if (donnees.code_refuse) {
                applique = null;
                try { sessionStorage.removeItem(MEMOIRE_APPLIQUE); } catch (e) { /* rien */ }
                afficher();
            }
            if (rep.status === 503) {
                const d = document.getElementById('pc-dialogue');
                d.querySelector('p').textContent = donnees.erreur || "Le paiement n'est pas encore ouvert.";
                d.showModal();
            } else {
                erreur.textContent = donnees.erreur || 'Le paiement est indisponible pour le moment.';
                erreur.hidden = false;
            }
        } catch (e) {
            erreur.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.';
            erreur.hidden = false;
        }
        payer.disabled = false;
        payer.textContent = texte;
    });

    // la barre du bas s'efface quand le panier lui-même est à l'écran (elle ferait doublon)
    new IntersectionObserver(([e]) => {
        document.getElementById('pc-barre').classList.toggle('cachee', e.isIntersecting);
    }, { threshold: 0.15 }).observe(document.getElementById('panier'));

    // retour de la page de paiement (bouton « retour » du navigateur) : le bouton redevient utilisable
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) { payer.disabled = false; payer.textContent = 'Passer au paiement'; }
    });

    // les 4 sachets en cercle (Hugo, 20/11) : on tourne à l'infini (flèches, glisser, clavier, toucher un sachet de côté) ;
    // le sachet de devant s'ouvre et se referme (toucher le sachet ou « Ouvrir le sachet »)
    const anneau = document.querySelector('.anneau-ext');
    if (anneau) {
        const fiches = [...anneau.querySelectorAll('.extension')];
        const points = [...document.querySelectorAll('.defiler .reperes i')];
        const n = fiches.length;
        let actif = 0;
        const placer = () => {
            fiches.forEach((f, k) => {
                const pos = (k - actif + n) % n; // 0 devant, 1 à droite, 2 derrière, 3 à gauche
                f.classList.remove('p0', 'p1', 'p2', 'p3');
                f.classList.add('p' + pos);
                f.setAttribute('aria-hidden', pos === 0 ? 'false' : 'true');
            });
            points.forEach((p, k) => p.classList.toggle('actif', k === actif));
        };
        // place des cartes dans la pile (0 = dessus) : au départ, dans l'ordre de sortie
        const pile = (f, ordre) => f.querySelectorAll('.carte-sortie').forEach((c, k) => {
            const d = ordre ? ordre[k] : k;
            c.style.setProperty('--d', d);
            c.classList.toggle('dessus', d === 0);
        });
        const ouvrir = (f, oui) => {
            f.classList.toggle('ouvert', oui);
            f.classList.remove('pret');
            clearTimeout(f._pret);
            if (oui) f._pret = setTimeout(() => f.classList.add('pret'), 1300); // toutes sorties : la pile est prête
            else {
                pile(f);
                f.querySelectorAll('.recto-verso').forEach((rv) => rv.classList.remove('claire', 'retourne'));
            }
            const b = f.querySelector('.ouvrir-sachet');
            b.textContent = oui ? 'Refermer le sachet' : 'Ouvrir le sachet';
        };
        // on tourne : le sachet ouvert se referme, ses cartes rentrent dedans et partent avec lui
        const tourner = (d) => {
            fiches.forEach((f) => { if (f.classList.contains('ouvert')) ouvrir(f, false); });
            actif = (actif + d + n) % n;
            placer();
        };
        document.querySelector('.defiler .precedente').addEventListener('click', () => tourner(-1));
        document.querySelector('.defiler .suivante').addEventListener('click', () => tourner(1));
        anneau.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); tourner(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); tourner(1); }
        });
        fiches.forEach((f) => {
            f.querySelector('.booster').addEventListener('click', () => {
                if (f.classList.contains('p1')) tourner(1);
                else if (f.classList.contains('p3')) tourner(-1);
                else if (f.classList.contains('p0')) ouvrir(f, !f.classList.contains('ouvert'));
            });
            f.querySelector('.ouvrir-sachet').addEventListener('click', () => ouvrir(f, !f.classList.contains('ouvert')));
            // un toucher sur la pile : la carte du dessus part sur le côté, puis passe sous la pile (en boucle)
            const cartes = [...f.querySelectorAll('.carte-sortie')];
            let occupe = false;
            f.querySelector('.cartes-sortie').addEventListener('click', (e) => {
                e.stopPropagation();
                if (!f.classList.contains('ouvert') || !f.classList.contains('p0') || occupe) return;
                const places = cartes.map((c) => Number(getComputedStyle(c).getPropertyValue('--d')));
                const dessus = cartes[places.indexOf(0)];
                occupe = true;
                f.classList.add('touchee'); // il a compris : plus de signal
                dessus.classList.add('vole');
                setTimeout(() => {
                    pile(f, places.map((d) => (d - 1 + cartes.length) % cartes.length));
                    dessus.classList.remove('vole');
                    // elle passe sous la pile en se retournant (en 2D : elle s'aplatit, change de face au milieu, se
                    // rouvre) : au tour suivant, on la voit de l'autre côté
                    const rv = dessus.querySelector('.recto-verso');
                    rv.classList.remove('retourne');
                    void rv.offsetWidth;
                    rv.classList.add('retourne');
                    setTimeout(() => rv.classList.toggle('claire'), 250);
                    rv.addEventListener('animationend', () => rv.classList.remove('retourne'), { once: true });
                    setTimeout(() => { occupe = false; }, 380);
                }, 300);
            });
        });
        // glisser du doigt (ou de la souris) : au-delà de 40 px, on tourne d'un cran
        let depart = null;
        anneau.addEventListener('pointerdown', (e) => { depart = { x: e.clientX, y: e.clientY }; });
        anneau.addEventListener('pointerup', (e) => {
            if (!depart) return;
            const dx = e.clientX - depart.x, dy = e.clientY - depart.y;
            depart = null;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                tourner(dx < 0 ? 1 : -1);
                // pas de « clic » sur un sachet à la fin d'un glissé
                const bloquer = (c) => { c.stopPropagation(); c.preventDefault(); };
                anneau.addEventListener('click', bloquer, { capture: true, once: true });
                setTimeout(() => anneau.removeEventListener('click', bloquer, { capture: true }), 300);
            }
        });
        anneau.addEventListener('pointercancel', () => { depart = null; });
        fiches.forEach((f) => pile(f));
        placer();
        // tout le monde voit les cartes au moins une fois (Hugo, 20/11) : la première fois que les sachets sont bien à
        // l'écran, celui de devant s'ouvre tout seul, un instant après (le temps de le voir fermé) ; sauf si le
        // visiteur y a déjà touché
        let touche = false;
        anneau.addEventListener('pointerdown', () => { touche = true; }, { once: true });
        const premiereVue = new IntersectionObserver(([e]) => {
            if (!e.isIntersecting) return;
            premiereVue.disconnect();
            setTimeout(() => {
                const devant = fiches[actif];
                if (!touche && !devant.classList.contains('ouvert')) ouvrir(devant, true);
            }, 900);
        }, { threshold: 0.6 });
        premiereVue.observe(anneau);
    }

    // arrivée depuis les offres du bas de la vitrine (/precommande?offre=jeu|quatre#panier) : l'offre est déjà dans le
    // panier (une seule fois : rien de plus si elle y est, et l'adresse perd ?offre pour qu'un rechargement n'ajoute rien).
    // ?offre=deux mène à la carte du pack, pour choisir ses 2 Saisons.
    const demandee = new URLSearchParams(location.search).get('offre');
    if (demandee) {
        if ((demandee === 'jeu' || demandee === 'quatre') && !panier.has(demandee)) panier.set(demandee, 1);
        history.replaceState(null, '', location.pathname + location.hash);
    }

    // champ « Code promo » du panier : le serveur dit si le code vaut quelque chose
    const formCode = document.querySelector('.code-promo');
    const messageCode = formCode.querySelector('.code-message');
    formCode.addEventListener('submit', async (e) => {
        e.preventDefault();
        const texte = formCode.code.value.trim();
        messageCode.textContent = '';
        messageCode.classList.remove('refuse');
        if (!texte) return;
        const bouton = formCode.querySelector('.appliquer');
        bouton.disabled = true;
        try {
            const rep = await fetch('/precommande/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: texte }),
            });
            const d = await rep.json().catch(() => ({}));
            if (rep.ok && d.code) {
                applique = { code: d.code, remise: d.remise };
                try { sessionStorage.setItem(MEMOIRE_APPLIQUE, JSON.stringify(applique)); } catch (err) { /* rien */ }
                formCode.code.value = '';
                afficher();
            } else {
                messageCode.textContent = d.erreur || 'Ce code ne marche pas.';
                messageCode.classList.add('refuse');
            }
        } catch (err) {
            messageCode.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.';
            messageCode.classList.add('refuse');
        }
        bouton.disabled = false;
    });
    document.querySelector('.retirer-code').addEventListener('click', () => {
        applique = null;
        try { sessionStorage.removeItem(MEMOIRE_APPLIQUE); } catch (e) { /* rien */ }
        afficher();
    });

    // compte à rebours jusqu'à la vraie fin de l'offre (jamais une fin inventée : L121-4 du code de la consommation)
    const compte = document.querySelector('.pc-code .compte');
    if (compte) {
        const fin = new Date(compte.dataset.fin).getTime();
        const deux = (n) => String(n).padStart(2, '0');
        const ecrire = () => {
            const reste = Math.max(0, Math.floor((fin - Date.now()) / 1000));
            const j = Math.floor(reste / 86400);
            compte.textContent = reste === 0 ? '' : `Fin dans ${j ? j + ' j ' : ''}${deux(Math.floor(reste / 3600) % 24)}:${deux(Math.floor(reste / 60) % 60)}:${deux(reste % 60)}`;
        };
        ecrire();
        setInterval(ecrire, 1000);
    }

    // En-tête (menu + bandeau) caché quand on descend, de retour dès qu'on remonte (Hugo, 24/11, test Joseph Joseph) ;
    // toujours visible en haut de page et quand une fenêtre est ouverte
    {
        let yAvant = window.scrollY, cumul = 0;
        window.addEventListener('scroll', () => {
            const y = window.scrollY, d = y - yAvant;
            yAvant = y;
            cumul = (cumul > 0) === (d > 0) ? cumul + d : d; // distance parcourue dans le même sens
            const cache = document.body.classList.contains('entete-cache');
            if (y < 80 || document.querySelector('dialog[open]')) { if (cache) document.body.classList.remove('entete-cache'); return; }
            if (!cache && cumul > 24) document.body.classList.add('entete-cache');
            else if (cache && cumul < -12) document.body.classList.remove('entete-cache');
        }, { passive: true });
        // un lien du menu (ou le clavier) le fait revenir
        document.querySelector('.pc-nav').addEventListener('focusin', () => document.body.classList.remove('entete-cache'));
    }

    // « Prévenez-moi » des offres avec extensions : inscription à la newsletter avec l'intérêt « extensions »
    const prevenir = document.getElementById('pc-prevenir');
    if (prevenir) {
        const form = prevenir.querySelector('form'), err = form.querySelector('.erreur');
        document.querySelectorAll('.prevenir').forEach((b) => b.addEventListener('click', () => { prevenir.showModal(); form.email.focus(); }));
        prevenir.querySelector('.fermer').addEventListener('click', () => prevenir.close());
        prevenir.addEventListener('click', (e) => { if (e.target === prevenir) prevenir.close(); });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.hidden = true;
            const bouton = form.querySelector('button[type="submit"]');
            bouton.disabled = true;
            try {
                const rep = await fetch('/precommande/newsletter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: form.email.value, site: form.site.value, interet: 'extensions' }),
                });
                const d = await rep.json().catch(() => ({}));
                if (rep.ok) { form.hidden = true; prevenir.querySelector('.merci').hidden = false; }
                else { err.textContent = d.erreur || 'Inscription impossible pour le moment.'; err.hidden = false; }
            } catch (er) {
                err.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.';
                err.hidden = false;
            }
            bouton.disabled = false;
        });
    }

    // fenêtre de l'offre de lancement : e-mail -> code affiché tout de suite (pas de vérification de l'adresse)
    const fenetre = document.getElementById('pc-newsletter');
    if (bandeau && fenetre) {
        const formulaire = fenetre.querySelector('.etape-email');
        const etapeCode = fenetre.querySelector('.etape-code');
        const erreurCode = formulaire.querySelector('.erreur');
        const montrerCode = () => {
            document.querySelectorAll('.code-texte').forEach((b) => { b.textContent = code; });
            bandeau.classList.add('obtenu');
            document.body.classList.add('code-obtenu');
            bandeau.querySelector('.avant').hidden = true;
            bandeau.querySelector('.apres').hidden = false;
            formulaire.hidden = true;
            etapeCode.hidden = false;
        };
        // code gardé d'une visite précédente : on le revérifie (l'offre a pu changer de code ou finir)
        if (code) {
            fetch('/precommande/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            }).then((rep) => {
                if (rep.ok) { montrerCode(); return; }
                if (rep.status === 404) {
                    code = '';
                    try { localStorage.removeItem(MEMOIRE_CODE); } catch (err) { /* rien */ }
                }
            }).catch(() => montrerCode());
        }
        document.querySelectorAll('.ouvrir-code').forEach((b) => b.addEventListener('click', () => {
            fenetre.showModal();
            if (!code) formulaire.email.focus();
        }));
        fenetre.querySelector('.fermer').addEventListener('click', () => fenetre.close());
        fenetre.addEventListener('click', (e) => { if (e.target === fenetre) fenetre.close(); });
        formulaire.addEventListener('submit', async (e) => {
            e.preventDefault();
            erreurCode.hidden = true;
            const bouton = formulaire.querySelector('button[type="submit"]');
            bouton.disabled = true;
            try {
                const rep = await fetch('/precommande/newsletter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: formulaire.email.value, site: formulaire.site.value }),
                });
                const d = await rep.json().catch(() => ({}));
                if (rep.ok && d.code) {
                    code = d.code;
                    try { localStorage.setItem(MEMOIRE_CODE, code); } catch (err) { /* rien */ }
                    montrerCode();
                    afficher();
                } else if (rep.ok) {
                    erreurCode.textContent = "Merci ! L'offre de lancement est terminée, mais vous êtes bien abonné.";
                    erreurCode.hidden = false;
                } else {
                    erreurCode.textContent = d.erreur || 'Inscription impossible pour le moment.';
                    erreurCode.hidden = false;
                }
            } catch (err) {
                erreurCode.textContent = 'Pas de connexion : vérifiez votre réseau et réessayez.';
                erreurCode.hidden = false;
            }
            bouton.disabled = false;
        });
        // copier : l'API du presse-papiers n'existe qu'en https ; sinon, l'ancienne méthode
        // copier : l'API du presse-papiers (https ou localhost) ; sinon (http sur le Wi-Fi, vieux Safari) un champ caché
        // DANS la fenêtre : quand elle est ouverte, tout le reste de la page est inerte et ne peut pas être sélectionné.
        // Si rien ne marche, le code est sélectionné à l'écran pour un appui long.
        const copierAncienne = () => {
            const zone = document.createElement('textarea');
            zone.value = code;
            zone.setAttribute('readonly', '');
            zone.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
            fenetre.append(zone);
            zone.focus();
            zone.select();
            zone.setSelectionRange(0, code.length);
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
            zone.remove();
            return ok;
        };
        const boutonCopier = fenetre.querySelector('.copier');
        const dire = (texte) => {
            boutonCopier.textContent = texte;
            clearTimeout(boutonCopier._minuterie);
            boutonCopier._minuterie = setTimeout(() => { boutonCopier.textContent = 'Copier'; }, 1800);
        };
        const selectionnerCode = () => {
            const b = etapeCode.querySelector('.code-texte');
            const plage = document.createRange();
            plage.selectNodeContents(b);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(plage);
        };
        boutonCopier.addEventListener('click', () => {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(code).then(() => dire('Copié'), () => {
                    if (copierAncienne()) dire('Copié'); else { selectionnerCode(); dire('Appui long'); }
                });
                return;
            }
            if (copierAncienne()) dire('Copié'); else { selectionnerCode(); dire('Appui long'); }
        });
    }

    afficher();
})();
