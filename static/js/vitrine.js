// Vitrine (page de vente) : tout ce qui vit au défilement.
// (23/11, retours de visiteurs) Les animations ne sont plus pilotées au doigt : chacune se joue seule quand sa section
// arrive à l'écran (« Lecteurs », plus bas) : toute la page depuis le 23/11 (les bandeaux de cartes en boucle).
// - la boîte en 3D du héros : elle flotte et se penche au doigt (un peu seulement : on ne montre pas son dos) ;
// - les lecteurs : freins, point 1 (MOJO), graphique, partie à 4, échecs, partie filmée, boîte de fin, chacun une fois
//   quand il arrive ; quitter sa section et revenir le relance, le toucher une fois fini aussi ; les textes se
//   dévoilent à part (enVague) et s'affichent en entier si on les dépasse ; flèche « suite » à la fin de chacun ;
// - les bandeaux de cartes du point 4 défilent en continu ; leurs cartes font un tour quand on les touche ;
// - les vidéos des stars (muettes, une seule avec le son), les questions qui s'ouvrent en douceur.
(function () {
    const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = document.getElementById('nav');
    const collante = document.getElementById('collante');
    const feuilles = document.querySelector('.feuilles-cote');
    const fond = document.getElementById('fond');
    const borne = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const lisse = (a, b, x) => { const t = borne((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => a + (b - a) * t;
    const etroit = () => window.innerWidth <= 820;
    const APERCU = 64; // px de la section suivante visibles sous le héros, sur téléphone (= vitrine.css)
    // Écrit un style seulement s'il change (Safari iPhone, 19/11 : à chaque image, des centaines de styles réécrits à
    // l'identique, même pour les sections hors de l'écran, faisaient recalculer la page et saccader le défilement)
    const ecrire = (el, prop, val) => {
        const v = String(val), m = el._styles || (el._styles = {});
        if (m[prop] === v) return;
        m[prop] = v;
        if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v;
    };

    // ======================= Scène 3D : la boîte, le plateau, les cartes =======================
    // Mesures réelles en mm : boîte 245 × 245 × 45, fond 241 × 43, plateau 470 plié en 4, cartes 50.
    const BOITE = 245, HAUT = 45, FOND = 241, HFOND = 43, PLATEAU = 470, Q = PLATEAU / 2, CASE = PLATEAU / 8, CARTE = 50;
    const EPAISSEUR = 0.7; // une carte, en mm (un peu plus que la vraie, pour que les piles se voient)
    // Les 4 équipes de départ (3-4 joueurs : Champion à droite du Roi, Pions en d2 e2), vues par chaque joueur ;
    // les alliés se font face : faces claires au Sud et au Nord, sombres à l'Est et à l'Ouest.
    const EQUIPES = [
        { angle: 0, face: 'clair', cartes: [['04-mojo', 4, 0], ['13-dysko', 5, 0], ['19-banjo', 3, 1], ['19-banjo', 4, 1]] },
        { angle: -90, face: 'sombre', cartes: [['03-karma', 4, 0], ['11-frank', 5, 0], ['34-bongo', 3, 1], ['34-bongo', 4, 1]] },
        { angle: 180, face: 'clair', cartes: [['01-azar', 4, 0], ['10-krak', 5, 0], ['35-tamtam', 3, 1], ['35-tamtam', 4, 1]] },
        { angle: 90, face: 'sombre', cartes: [['02-shans', 4, 0], ['26-rokk', 5, 0], ['33-shasha', 3, 1], ['33-shasha', 4, 1]] },
    ];

    function creerScene(el) {
        const img = JSON.parse(el.dataset.images);
        const monde = div('monde');
        el.appendChild(monde);
        const s = { el, monde, u: 1, doigt: 0, vitesse: 0, tenue: false, t: 0, planes: [], images: new Set() };

        function div(cls, parent) {
            const d = document.createElement('div');
            d.className = cls;
            if (parent) parent.appendChild(d);
            return d;
        }
        // Un plan de l × h mm, centré sur l'origine de son parent, posé par la fonction pose(u) → transform
        function plan(parent, l, h, cls, fond, pose) {
            const d = div('plan ' + (cls || ''), parent);
            if (fond) { d.style.backgroundImage = `url("${fond}")`; s.images.add(fond); }
            s.planes.push({ d, l, h, pose });
            return d;
        }
        const pivot = (parent) => div('pivot', parent);
        // Les 4 parois d'une boîte de côté c, hauteur h : le bord du haut de chaque image touche le dessus
        function parois(parent, c, h, images, cls, dedans) {
            const r = c / 2, z = h / 2;
            const cotes = [
                ['bas', (u) => `translate3d(0,${r * u}px,${z * u}px) rotateX(-90deg)`],
                ['haut', (u) => `translate3d(0,${-r * u}px,${z * u}px) rotateX(90deg) rotateZ(180deg)`],
                ['droite', (u) => `translate3d(${r * u}px,0,${z * u}px) rotateY(90deg) rotateZ(-90deg)`],
                ['gauche', (u) => `translate3d(${-r * u}px,0,${z * u}px) rotateY(-90deg) rotateZ(90deg)`],
            ];
            // vue de l'intérieur : la paroi du bas se voit comme celle du haut retournée, etc.
            const inverse = { bas: 'haut', haut: 'bas', droite: 'gauche', gauche: 'droite' };
            cotes.forEach(([nom]) => {
                const pose = dedans
                    ? (u) => cotes.find((x) => x[0] === inverse[nom])[1](u).replace(/translate3d\(([^)]*)\)/, () => {
                        const sx = nom === 'droite' ? r : nom === 'gauche' ? -r : 0, sy = nom === 'bas' ? r : nom === 'haut' ? -r : 0;
                        return `translate3d(${sx * u}px,${sy * u}px,${z * u}px)`;
                    })
                    : cotes.find((x) => x[0] === nom)[1];
                const d = plan(parent, c, h, cls, images && images[nom], pose);
                if (!dedans) ecrire(d, '--sombre', { haut: .12, bas: .5, droite: .45, gauche: .3 }[nom]);
            });
        }

        // Ombre sur la table
        s.ombre = plan(monde, PLATEAU * 1.12, PLATEAU * 1.12, 'ombre', null, null);

        // Fond de boîte : intérieur sombre, parois de feuilles
        s.fond = pivot(monde);
        plan(s.fond, FOND - 4, FOND - 4, 'fond-dedans', null, (u) => `translate3d(0,0,${0.3 * u}px)`);
        parois(s.fond, FOND, HFOND, { bas: img.paroi, haut: img.paroi, droite: img.paroi, gauche: img.paroi }, 'paroi');
        parois(s.fond, FOND - 4, HFOND, null, 'dedans', true);
        plan(s.fond, BOITE - 1, BOITE - 1, 'dessous', img.dos, (u) => `translate3d(0,0,${-0.3 * u}px) rotateY(180deg)`);

        // Inlay de la boîte (gabarit Fabryka, habillage retenu par Hugo le 16/11/2026) : ses panneaux en mm, pliés comme
        // dans la vue Remotion (jeu/video/src/Inlay.tsx), chargés à part (vitrine/inlay/panneaux.json + feuille.webp).
        // 9 cases de 53 mm séparées par des couloirs de 19 mm : les piles de cartes sont rangées dedans.
        s.contenu = pivot(s.fond);
        const C = 72;
        if (img.inlay) {
            fetch(`${img.inlay}/panneaux.json`).then((r) => r.json()).then((g) => {
                const [FW, FH] = g.feuille, X = 98.5; // centre du fond des cases (197 mm)
                const LUM = [-0.35, -0.55, 0.76];
                g.panneaux.forEach((pn) => {
                    const [x0, y0, x1, y1] = pn.r, l = x1 - x0, hh = y1 - y0, U = pn.U, V = pn.V;
                    const n = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
                    const c = [0, 1, 2].map((k) => pn.O[k] + U[k] * l / 2 + V[k] * hh / 2 - (k < 2 ? X : 0));
                    const d = plan(s.contenu, l, hh, 'inlay', `${img.inlay}/feuille.webp`,
                        (u) => `matrix3d(${U.join(',')},0,${V.join(',')},0,${n.join(',')},0,${c[0] * u},${c[1] * u},${c[2] * u},1)`);
                    d.style.backgroundSize = `${FW / l * 100}% ${FH / hh * 100}%`;
                    d.style.backgroundPosition = `${x0 / (FW - l) * 100}% ${y0 / (FH - hh) * 100}%`;
                    const e = 0.5 + 0.5 * Math.max(0, n[0] * LUM[0] + n[1] * LUM[1] + n[2] * LUM[2]);
                    d.style.filter = `brightness(${e.toFixed(3)})`;
                });
                s.pose = false; // tailler les nouveaux panneaux au prochain dessin
            }, () => {});
        }
        // La boîte est vide au départ (toutes les cartes sont sur la table, Hugo 16/11) : chaque carte qui rentre se pose
        // sur la pile de sa case ; place() donne la prochaine hauteur libre
        s.cases = [];
        for (let i = 0; i < 9; i++) s.cases.push({ cx: ((i % 3) - 1) * C, cy: (Math.floor(i / 3) - 1) * C, n: 0 });
        const place = (i) => { const c = s.cases[i % 9]; c.n += 1; return { px: c.cx, py: c.cy, pz: 0.6 + (c.n - 1) * EPAISSEUR }; };

        // Les 72 autres cartes de la boîte (84 Personnages + 4 cartes d'aide, moins les 16 de la partie), en vrac sur la
        // table au nord et au sud du plateau (fin de page seulement) : elles se rangent les premières
        s.vrac = [];
        if (el.dataset.scene === 'fermeture') {
            // boîte de base (cartes.json, « boite: base ») : 4 Rois, 20 Personnages en 4 exemplaires
            const RESTE = { '07-funk': 4, '10-krak': 3, '11-frank': 3, '13-dysko': 3, '14-folk': 4, '18-jazz': 4, '19-banjo': 2,
                '24-salsa': 4, '26-rokk': 3, '30-dub': 4, '31-bass': 4, '33-shasha': 2, '34-bongo': 2, '35-tamtam': 2,
                '37-marakas': 4, '38-gong': 4, '39-zyg': 4, '40-zwang': 4, '41-zug': 4, '42-zag': 4, aide: 4 };
            const liste = [];
            Object.entries(RESTE).forEach(([nom, n]) => { for (let k = 0; k < n; k++) liste.push(nom); });
            let graine = 11;
            const hasard = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
            for (let k = liste.length - 1; k > 0; k--) { const m = Math.floor(hasard() * (k + 1)); [liste[k], liste[m]] = [liste[m], liste[k]]; }
            liste.forEach((nom, k) => {
                const src = nom === 'aide' ? `${img.aide}` : `${img.cartes}/${hasard() < 0.5 ? 'clair' : 'sombre'}/${nom}.webp`;
                const d = plan(monde, CARTE, CARTE, 'carte', src, null);
                const cote = k % 2 ? 1 : -1;
                s.vrac.push(Object.assign({
                    d, ordre: k,
                    // en tas autour de quelques points, au nord et au sud (bord du plateau à 235 mm), certaines débordent dessus
                    x: -235 + hasard() * 470, y: cote * (228 + hasard() * 74), z: 0.6 + k * 0.08, rz: hasard() * 360 - 180,
                }, place(k)));
            });
        }

        // Cartes de la partie : sur les piles des 9 cases, puis en 4 piles hors du plateau, puis sur leurs cases
        s.cartes = [];
        EQUIPES.forEach((eq, e) => eq.cartes.forEach(([nom, col, rang], k) => {
            const d = plan(monde, CARTE, CARTE, 'carte', `${img.cartes}/${eq.face}/${nom}.webp`, null);
            // case vue par le joueur Sud, puis tournée vers le joueur de l'équipe
            const x0 = (col - 3.5) * CASE, y0 = (3.5 - rang) * CASE;
            const a = eq.angle * Math.PI / 180;
            s.cartes.push({
                d, angle: eq.angle, ordre: e * 4 + k,
                x: x0 * Math.cos(a) - y0 * Math.sin(a), y: x0 * Math.sin(a) + y0 * Math.cos(a),
                ...place(e * 4 + k),
                // pile d'attente, hors du plateau déplié (bord à 235 mm) : Sud et Est en bas, Nord et Ouest en haut
                ex: [-70, 70, 70, -70][e], ey: [1, 1, -1, -1][e] * (Q + 42), ez: 1 + k * 0.9,
            });
        }));

        // Plateau plié en 4 : colonne de droite repliée sur la gauche, quarts du bas repliés sur ceux du haut
        s.plateau = pivot(monde);
        const quart = (parent, qx, qy) => {
            const pos = `${qx > 0 ? 100 : 0}% ${qy > 0 ? 100 : 0}%`;
            const avant = plan(parent, Q, Q, 'quart', img.plateau, (u) => `translate3d(${qx * Q / 2 * u}px,${qy * Q / 2 * u}px,0)`);
            avant.style.backgroundSize = '200% 200%';
            avant.style.backgroundPosition = pos;
            const dos = plan(parent, Q, Q, 'verso-plateau', img.verso, (u) => `translate3d(${qx * Q / 2 * u}px,${qy * Q / 2 * u}px,${-0.2 * u}px) rotateY(180deg)`);
            dos.style.backgroundSize = '200% 200%';
            dos.style.backgroundPosition = `${qx < 0 ? 100 : 0}% ${qy > 0 ? 100 : 0}%`;
        };
        s.colG = pivot(s.plateau);
        quart(s.colG, -1, -1);
        s.basG = pivot(s.colG);
        quart(s.basG, -1, 1);
        s.colD = pivot(s.plateau);
        quart(s.colD, 1, -1);
        s.basD = pivot(s.colD);
        quart(s.basD, 1, 1);

        // Couvercle : le dessus (face de la boîte) et ses 4 tranches
        s.couvercle = pivot(monde);
        s.dessus = plan(s.couvercle, BOITE, BOITE, 'reflet', img.face, (u) => `translate3d(0,0,${(HAUT + 0.5) * u}px)`);
        parois(s.couvercle, BOITE, HAUT, img, 'tranche');
        plan(s.couvercle, BOITE - 1, BOITE - 1, 'dessous', null, (u) => `translate3d(0,0,${(HAUT - 0.5) * u}px) rotateY(180deg)`);

        // Le doigt tourne la boîte (balayage horizontal ; le défilement vertical reste à la page)
        if (!calme) {
            let x0 = 0, t0 = 0;
            el.addEventListener('pointerdown', (e) => { s.tenue = true; s.vitesse = 0; x0 = e.clientX; t0 = performance.now(); });
            el.addEventListener('pointermove', (e) => {
                if (!s.tenue) return;
                // souris relâchée ailleurs (sur le texte, hors de la fenêtre) : la boîte restait « tenue » et suivait la
                // souris, tournée et plus bas que celle du haut (Hugo, 17/11)
                if (e.pointerType === 'mouse' && !(e.buttons & 1)) { s.tenue = false; return; }
                const dx = e.clientX - x0, t = performance.now();
                if (Math.abs(dx) > 3 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
                s.doigt += dx * 0.6;
                s.vitesse = (dx * 0.6) / Math.max(8, t - t0) * 16;
                x0 = e.clientX; t0 = t;
            });
            const lacher = () => { s.tenue = false; };
            // relâchée n'importe où dans la page, pas seulement sur la boîte
            window.addEventListener('pointerup', lacher);
            window.addEventListener('pointercancel', lacher);
            window.addEventListener('blur', lacher);
        }
        new IntersectionObserver((es) => { s.visible = es[0].isIntersecting; }).observe(el);
        el.classList.add('prete');
        return s;
    }

    // Côté de la boîte au repos, et où elle se pose (au-dessus du texte)
    // Hauteur de référence figée : sur téléphone, la barre d'adresse qui se replie au défilement change innerHeight,
    // et la boîte puis le titre sautaient au tout début (Hugo, 16/11) ; elle ne change qu'avec la largeur (rotation)
    let largeurRef = 0, hauteurRef = 0;
    // Sur ordinateur, pas de barre d'adresse qui bouge : la hauteur réelle, sinon une fenêtre redimensionnée après le
    // chargement décalait la boîte (et la boîte du bas ne tombait plus à la place de celle du haut : Hugo, 17/11)
    const ecranTactile = window.matchMedia('(hover: none), (pointer: coarse)');
    function hauteurStable() {
        if (!ecranTactile.matches) return window.innerHeight;
        if (window.innerWidth !== largeurRef || !hauteurRef) { largeurRef = window.innerWidth; hauteurRef = window.innerHeight; }
        return hauteurRef;
    }
    function repos(nom) {
        const w = window.innerWidth, h = hauteurStable();
        if (etroit()) {
            if (nom === 'fermeture') { const S = Math.min(0.54 * w, 0.24 * h, 230); return { S, x: 0, y: 78 + S * 0.62 - h / 2 }; }
            // héros (23/11) : la section fait l'écran moins APERCU (vitrine.css), le haut de la suivante se voit
            // (des visiteurs ne descendaient pas) ; (24/11, Hugo : « la boîte ressort mieux un peu plus basse ») boîte
            // et texte 22 px plus bas (BAISSE, aussi dans vitrine.css), boîte un peu plus petite pour que tout tienne
            const S = Math.min(0.6 * w, 0.28 * h, 290);
            return { S, x: 0, y: 32 + 22 + S * 0.62 - Math.max(560, h - APERCU) / 2 };
        }
        // ordinateur : la boîte au centre, le texte dessous ; en fin de page exactement la même boîte qu'au début
        // (même taille, même place, donc même vue : Hugo, 17/11)
        // la boîte rapetisse sur un écran bas pour que le texte et ses boutons restent visibles
        // 480 → 525 (23/11) : l'accroche tient sur 2 lignes ; minimum 160 (200 coupait « essayer gratuitement » en 1280 × 720)
        const S = Math.max(160, Math.min(360, 0.38 * h, (h - 525) / 1.3)); // 440 avant l'interligne 1,14 des titres (18/11)
        return { S, x: 0, y: 80 + S * 0.62 - h / 2 };
    }

    // Pièce cachée = retirée de la 3D (display), pas seulement invisible : la scène du bas a ~200 plans (cartes en vrac,
    // inlay) ; invisibles mais présents, ils faisaient mal dessiner la boîte fermée par Firefox sur le PC d'Hugo (17/11)
    // Images de la scène chargées et décodées avant qu'elle n'arrive : la boîte de fin montre d'un coup ~90 cartes
    // jusque-là cachées ; chargées à ce moment-là, l'ouverture ramait à la première visite (Hugo, 19/11)
    function prechargerScene(s) {
        if (s.precharge) return;
        s.precharge = [];
        s.images.forEach((src) => {
            const im = new Image();
            im.decoding = 'async';
            im.src = src;
            if (im.decode) im.decode().catch(() => {});
            s.precharge.push(im); // gardées : sans référence, le navigateur peut oublier l'image décodée
        });
    }
    function cacher(el, oui) {
        if (el._cache === oui) return;
        el._cache = oui;
        el.style.display = oui ? 'none' : '';
    }

    // Où mettre la perspective (Hugo, 17/11) :
    // - Firefox : dans la transformation de la boîte. Avec la propriété perspective sur le conteneur, dans la section
    //   collante du bas, Firefox (rendu par la carte graphique) plaçait l'œil à la position non collée de la section,
    //   bien plus haut : la boîte du bas était vue d'au-dessus. Même image : translate puis perspective.
    // - WebKit et Chrome : sur le conteneur (perspective + perspective-origin) ; WebKit dessine mal la boîte avec
    //   perspective() dans sa transformation (en haut à gauche, ou noire).
    const PERSP_DANS_BOITE = CSS.supports('-moz-appearance', 'none');

    // Pose toute la scène pour t ∈ [0, 1] : 0 = boîte fermée, 1 = partie prête
    function poser(s, t, temps) {
        const w = window.innerWidth, h = hauteurStable();
        const r = repos(s.el.dataset.scene);
        const u = r.S / BOITE;
        if (u !== s.u || !s.pose) {
            s.u = u; s.pose = true;
            s.planes.forEach((p) => {
                p.d.style.width = p.l * u + 'px';
                p.d.style.height = p.h * u + 'px';
                ecrire(p.d, 'left', -p.l * u / 2 + 'px');
                ecrire(p.d, 'top', -p.h * u / 2 + 'px');
                if (p.pose) ecrire(p.d, 'transform', p.pose(u));
            });
            ecrire(s.el.parentElement, '--S', r.S + 'px');
            if (s.el.dataset.scene === 'heros') requestAnimationFrame(() => placerDescendre()); // le texte a bougé
            s.persp = Math.max(w, h) * 1.7;
            if (!PERSP_DANS_BOITE) ecrire(s.el, 'perspective', s.persp + 'px');
        }
        // Caméra : debout de trois quarts → couchée sur la table → recul pour voir tout le plateau
        const couche = lisse(0.08, 0.26, t);
        const boiteAplat = Math.min(w * 0.82, h * 0.62) / (BOITE * u);
        // le plateau et les piles de cartes posées au Nord et au Sud (≈ 600 mm de profondeur) doivent tenir dans l'écran
        const plateauAplat = Math.min(w * 0.98 / (1.1 * PLATEAU), (h - (etroit() ? 150 : 190)) / (etroit() ? 0.85 * PLATEAU : 0.78 * 600)) / u;
        let k = mix(1, boiteAplat, couche);
        k = mix(k, plateauAplat, lisse(0.44, 0.62, t));
        const debout = 1 - couche;
        const balance = calme ? 0 : debout;
        // de face (Hugo, 17/11 : elle rend mieux pile de face), penchée vers nous de 18° pour montrer la tranche du
        // haut ; on la tourne au doigt
        let ay = (s.doigt + (s.tour || 0)) * debout + Math.sin(temps / 1.7) * 4 * balance;
        const ax = mix(etroit() ? 38 : 50, -18, debout) + Math.sin(temps / 2.3) * 2.5 * balance;
        const az = mix(-8, 0, debout) + s.doigt * (1 - debout) * 0.3;
        // arrivée : la boîte pivote doucement d'un huitième de tour
        if (s.el.dataset.scene === 'heros' && !calme) ay -= 45 * (1 - lisse(0, 1, temps / 1.4));
        const flotte = calme ? 0 : Math.sin(temps / 1.9) * 7 * debout;
        const ox = r.x * debout, oy = r.y * debout + (etroit() ? 6 : -10) * couche + flotte;
        if (!PERSP_DANS_BOITE) ecrire(s.el, 'perspectiveOrigin', `calc(50% + ${ox}px) calc(50% + ${oy}px)`);
        const zc = HAUT / 2 * debout * u;
        ecrire(s.monde, 'transform', `translate(${ox}px,${oy}px)${PERSP_DANS_BOITE ? ` perspective(${s.persp}px)` : ''} scale(${k}) rotateX(${ax}deg) rotateY(${ay}deg) rotateZ(${az}deg) translateZ(${-zc}px)`);
        ecrire(s.dessus, '--reflet', 50 + ay * 1.2 + '%');

        // Couvercle : il se soulève, puis part vers le fond
        const leve = lisse(0.26, 0.36, t), part = lisse(0.32, 0.44, t);
        ecrire(s.couvercle, 'transform', `translate3d(0,${-900 * part * u}px,${(200 * leve + 120 * part) * u}px) rotateX(${-25 * part}deg)`);
        cacher(s.couvercle, part >= 1);

        // Plateau : il sort du fond et recule, puis (les cartes sorties) se pose au centre et se déplie : droite, puis bas
        const monte = lisse(0.36, 0.46, t), pose = lisse(0.52, 0.64, t);
        const u1 = lisse(0.54, 0.61, t), u2 = lisse(0.6, 0.67, t);
        const decal = Q / 2 * (1 - pose);
        const bz = mix(mix(HFOND - 12, 95, monte), 0.5, pose);
        const recule = -210 * monte * (1 - pose);
        ecrire(s.plateau, 'transform', `translate3d(${decal * u}px,${(decal + recule) * u}px,${bz * u}px) rotateX(${-12 * monte * (1 - pose)}deg)`);
        ecrire(s.colD, 'transform', `translateZ(${3 * (1 - u1) * u}px) rotateY(${-180 * (1 - u1)}deg)`);
        // boîte fermée : le plateau plié reste caché (sinon son dos passait parfois devant le couvercle)
        cacher(s.plateau, t < 0.3);
        cacher(s.contenu, t < 0.27);
        ecrire(s.basG, 'transform', `translateZ(${1.2 * (1 - u2) * u}px) rotateX(${180 * (1 - u2)}deg)`);
        ecrire(s.basD, 'transform', `translateZ(${1.2 * (1 - u2) * u}px) rotateX(${180 * (1 - u2)}deg)`);

        // Fond de boîte : vidé, il glisse sur le côté (il ne croise ni les piles ni le plateau)
        const sort = lisse(0.5, 0.58, t);
        ecrire(s.fond, 'transform', `translate3d(${1000 * sort * u}px,0,0)`);
        cacher(s.fond, sort >= 1);

        // Ombre : sous la boîte, puis sous le plateau
        const taille = mix(BOITE * 1.25, PLATEAU * 1.12, pose);
        ecrire(s.ombre, 'transform', `translate3d(0,0,${-1 * u}px) scale(${taille / (PLATEAU * 1.12)})`);
        ecrire(s.ombre, 'opacity', mix(0.9, 0.75, pose));

        // Cartes : du fond de la boîte à 4 piles posées hors du plateau, puis, le plateau déplié, sur leurs cases
        const monteC = lisse(0.42, 0.455, t), vaC = lisse(0.45, 0.52, t), poseC = lisse(0.49, 0.52, t);
        s.cartes.forEach((c) => {
            const debut = 0.68 + c.ordre * 0.0135, f = lisse(debut, debut + 0.07, t);
            const x = mix(mix(c.px, c.ex, vaC), c.x, f), y = mix(mix(c.py, c.ey, vaC), c.y, f);
            const z = mix(mix(mix(c.pz, 62, monteC), c.ez, poseC), 1.2, f) + Math.sin(Math.PI * f) * 35;
            const rz = mix(0, c.angle, f) + Math.sin(Math.PI * f) * 20;
            ecrire(c.d, 'transform', `translate3d(${x * u}px,${y * u}px,${z * u}px) rotateZ(${rz}deg)`);
            // boîte fermée : inutile de dessiner les cartes
            cacher(c.d, t < 0.27);
        });
        // Cartes en vrac : elles s'envolent une à une dans les cases, une fois le fond de boîte arrivé
        s.vrac.forEach((c) => {
            const debut = 0.47 - c.ordre * 0.0006, f = 1 - lisse(debut, debut + 0.03, t); // tout est rangé avant t = 0,5 : la boîte est là
            const x = mix(c.x, c.px, f), y = mix(c.y, c.py, f);
            const z = mix(c.z, c.pz, f) + Math.sin(Math.PI * f) * 70;
            const rz = mix(c.rz, 0, f);
            ecrire(c.d, 'transform', `translate3d(${x * u}px,${y * u}px,${z * u}px) rotateZ(${rz}deg)`);
            cacher(c.d, t < 0.27);
        });
        if (s.vue > 0) poserVue(s, s.vue, temps, r, u, w, h);
    }

    // Fin de page, après le rangement (Hugo, 18/11 : « la boucle est bouclée », puis on montre ce qu'on achète) : la boîte
    // fermée se rouvre en vue d'ensemble. Le couvercle se lève et se pose debout au fond, le fond de boîte recule avec ses
    // cartes rangées dans l'inlay, le plateau en sort, se pose devant et se déplie, puis les 16 cartes de la partie à 4 se
    // posent sur leurs cases. v ∈ [0, 1] ; à v = 0, c'est la boîte fermée de la fin du rangement (t = 0).
    // Coordonnées de la table en mm (y vers le spectateur) ; tout est centré sur l'origine.
    // de face, comme la boîte du haut (Hugo, 18/11) : couvercle debout au fond à gauche, fond de boîte à droite, côte à côte
    // derrière le plateau sans le toucher
    const VUE = { plateau: 150, fond: [135, -235], couvercle: [-130, -215] };
    // hauteur de l'offre sur téléphone, lue une fois par largeur d'écran (elle ne change qu'avec elle)
    let offreLue = { w: 0, h: 0 };
    function hauteurOffre() {
        const o = document.querySelector('.fermeture .offre');
        if (!o) return 420;
        if (offreLue.w !== window.innerWidth || !offreLue.h) offreLue = { w: window.innerWidth, h: o.offsetHeight + 20 };
        return offreLue.h;
    }
    function poserVue(s, v, temps, r, u, w, h) {
        const cam = lisse(0, 0.42, v);
        // caméra : de la boîte debout (même pose qu'en fin de rangement) à une vue plongeante, de face
        const balance = calme ? 0 : 1 - cam;
        const ax = mix(-18 + Math.sin(temps / 2.3) * 2.5 * balance, 54, cam);
        const ay = mix(s.doigt + Math.sin(temps / 1.7) * 4 * balance, 0, cam);
        const az = 0;
        // place à l'écran : à gauche de l'offre sur ordinateur, au-dessus sur téléphone
        // téléphone : la scène prend toute la place au-dessus de l'offre (mesurée), et tient dans la largeur
        const haut = etroit() ? hauteurOffre() : 0;
        const mo = s.offre || 0;
        const large = etroit() ? w * 1.0 : w * 0.56;
        const haute = etroit() ? mix(h * 0.8, Math.max(220, h - haut - 24), mo) : h * 0.8;
        const kV = Math.min(large / 640, haute / (etroit() ? 560 : 640)) / u;
        const k = mix(1, kV, cam);
        const oxV = etroit() ? 0 : -w * 0.2, oyV = etroit() ? mix(0, (h - haut) / 2 - h / 2 + 8, mo) : 40;
        const flotte = calme ? 0 : Math.sin(temps / 1.9) * 7 * (1 - cam);
        const ox = mix(r.x, oxV, cam), oy = mix(r.y + flotte, oyV, cam);
        if (!PERSP_DANS_BOITE) ecrire(s.el, 'perspectiveOrigin', `calc(50% + ${ox}px) calc(50% + ${oy}px)`);
        const zc = HAUT / 2 * (1 - cam) * u;
        ecrire(s.monde, 'transform', `translate(${ox}px,${oy}px)${PERSP_DANS_BOITE ? ` perspective(${s.persp}px)` : ''} scale(${k}) rotateX(${ax}deg) rotateY(${ay}deg) rotateZ(${az}deg) translateZ(${-zc}px)`);

        // couvercle : il se soulève, recule et se redresse face à nous, appuyé un peu en arrière
        const lc = lisse(0.06, 0.34, v);
        const xC = VUE.couvercle[0] * lc, yC = VUE.couvercle[1] * lc, zC = (BOITE / 2 - 8) * lc + Math.sin(Math.PI * lc) * 90;
        ecrire(s.couvercle, 'transform', `translate3d(${xC * u}px,${yC * u}px,${zC * u}px) rotateX(${-76 * lc}deg)`);
        cacher(s.couvercle, false);
        ecrire(s.dessus, '--reflet', '50%');

        // fond de boîte : il recule, ses cartes rangées dedans
        const lf = lisse(0.12, 0.36, v), xF = VUE.fond[0] * lf, yF = VUE.fond[1] * lf;
        ecrire(s.fond, 'transform', `translate3d(${xF * u}px,${yF * u}px,0)`);
        cacher(s.fond, false);
        cacher(s.contenu, false);
        s.vrac.forEach((c) => {
            ecrire(c.d, 'transform', `translate3d(${(c.px + xF) * u}px,${(c.py + yF) * u}px,${c.pz * u}px)`);
            cacher(c.d, false);
        });

        // plateau : il sort du fond, vient se poser devant et se déplie (droite, puis bas)
        const sortP = lisse(0.3, 0.5, v), u1 = lisse(0.5, 0.6, v), u2 = lisse(0.58, 0.68, v);
        const xP = mix(xF + Q / 2, 0, sortP), yP = mix(yF + Q / 2, VUE.plateau, sortP);
        const zP = mix(HFOND - 12, 0.5, sortP) + Math.sin(Math.PI * sortP) * 110;
        // plié, il est rangé dans le quart du haut à gauche : il se pose là, puis se déplie vers la droite et le bas
        ecrire(s.plateau, 'transform', `translate3d(${xP * u}px,${yP * u}px,${zP * u}px)`);
        ecrire(s.colD, 'transform', `translateZ(${3 * (1 - u1) * u}px) rotateY(${-180 * (1 - u1)}deg)`);
        ecrire(s.basG, 'transform', `translateZ(${1.2 * (1 - u2) * u}px) rotateX(${180 * (1 - u2)}deg)`);
        ecrire(s.basD, 'transform', `translateZ(${1.2 * (1 - u2) * u}px) rotateX(${180 * (1 - u2)}deg)`);
        cacher(s.plateau, v < 0.28);

        // les 16 cartes de la partie : du fond de boîte vers leurs cases, une à une
        s.cartes.forEach((c) => {
            const debut = 0.66 + c.ordre * 0.012, f = lisse(debut, debut + 0.07, v);
            const x = mix(c.px + xF, c.x, f), y = mix(c.py + yF, c.y + VUE.plateau, f);
            const z = mix(c.pz + 4, 1.2, f) + Math.sin(Math.PI * f) * 45;
            const rz = mix(0, c.angle, f) + Math.sin(Math.PI * f) * 20;
            ecrire(c.d, 'transform', `translate3d(${x * u}px,${y * u}px,${z * u}px) rotateZ(${rz}deg)`);
            cacher(c.d, f <= 0);
        });

        // ombres : sous le plateau
        ecrire(s.ombre, 'transform', `translate3d(0,${VUE.plateau * sortP * u}px,${-1 * u}px) scale(${mix(BOITE * 1.25, PLATEAU * 1.12, sortP) / (PLATEAU * 1.12)})`);
        ecrire(s.ombre, 'opacity', 0.75);
    }

    const scenes = [...document.querySelectorAll('.scene3d')].map(creerScene);
    const sceneHeros = scenes.find((s) => s.el.dataset.scene === 'heros');
    const sceneFermeture = scenes.find((s) => s.el.dataset.scene === 'fermeture');
    const fermeture = document.getElementById('boite');
    const descendre = document.querySelector('.descendre');
    // la flèche au milieu de la place libre sous « essayer gratuitement en ligne » ; cachée s'il n'y en a pas
    // (Hugo, 24/11 : sur téléphone elle tombait sur le lien)
    let placeDescendre = true;
    function placerDescendre() {
        if (!descendre || getComputedStyle(descendre).display === 'none') return;
        const heros = descendre.offsetParent, essayer = document.querySelector('.promesse .essayer');
        if (!heros || !essayer) return;
        const bas = essayer.getBoundingClientRect().bottom - heros.getBoundingClientRect().top;
        const libre = heros.clientHeight - bas, taille = descendre.offsetHeight;
        placeDescendre = libre >= taille + 4;
        ecrire(descendre, 'top', `${(bas + Math.max(2, (libre - taille) / 2 - 4)).toFixed(0)}px`);
        ecrire(descendre, 'bottom', 'auto');
    }
    if (document.fonts) document.fonts.ready.then(placerDescendre);
    const freins = document.getElementById('freins');
    const enLigne = document.getElementById('en-ligne');
    const freinsLi = [...freins.querySelectorAll('.liste-freins li')];
    const freinsVue = freins.querySelector('.plateau-mt .vue');
    const freinsScene = freins.querySelector('.scene-freins');
    // Point 1 (23/11 : sa propre section, Hugo) : une copie du plateau de MATATAK des freins, faite avant les halos et
    // les ombres des flèches ; c'est elle qui zoome sur MOJO
    const point1 = document.querySelector('.point-1');
    const plateauP1 = freins.querySelector('.plateau-mt').cloneNode(true);
    point1.querySelector('.scene-point1 .plateaux').appendChild(plateauP1);
    const vueP1 = plateauP1.querySelector('.vue');
    // Point 1 (revue des animations, 19/11) : le zoom, le fondu des cartes, l'avance de MOJO, ses symboles qui brillent
    // et les flèches sont écrits directement sur chaque élément ; avant, 6 variables posées sur .vue faisaient
    // recalculer tous ses enfants à chaque image. L'ombre des flèches est une copie sombre dessous (plus de filtre).
    const vedetteMt = vueP1.querySelector('img.vedette');
    const cartesMt = [...vueP1.querySelectorAll('img:not(.vedette)')];
    const lueursMt = [...vueP1.querySelectorAll('.lueur')];
    // un halo doré derrière chaque symbole (à la place de l'ombre lumineuse du filtre)
    const halosMt = lueursMt.map((l) => {
        const halo = document.createElement('i');
        halo.className = 'halo';
        halo.style.left = l.style.left; halo.style.top = l.style.top;
        l.before(halo);
        return halo;
    });
    const svgFleches = vueP1.querySelector('.fleches-mt');
    const ombresFleches = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ombresFleches.setAttribute('class', 'ombres');
    ombresFleches.setAttribute('transform', 'translate(0 2.5)');
    const flechesMt = [...svgFleches.querySelectorAll(':scope > g')].map((g) => {
        const o = g.cloneNode(true);
        ombresFleches.appendChild(o);
        const l = parseFloat(g.style.getPropertyValue('--l')) || 0;
        return [g, o].map((x) => ({ g: x, l, ligne: x.querySelector('line'), tete: x.querySelector('.tete') }));
    }).flat();
    svgFleches.insertBefore(ombresFleches, svgFleches.firstChild);
    // chaque pièce porte la liste de ses cases, une par position : data-c="e2 e4 e4 …"
    const piecesFreins = [...freins.querySelectorAll('.echiquier .pieces > g')].map((el) => ({ el, c: el.dataset.c.split(' ') }));
    const coupsFreins = [...freins.querySelectorAll('.echiquier .coups')];
    const versCase = (s) => [s.charCodeAt(0) - 97, +s[1] - 1];
    // position continue f (2,4 = entre la position 2 et la 3) → colonne, rangée
    const surChemin = (c, f) => {
        const k = Math.min(c.length - 1, Math.floor(f)), k2 = Math.min(c.length - 1, k + 1), t = f - k;
        const [x0, y0] = versCase(c[k]), [x1, y1] = versCase(c[k2]);
        return [mix(x0, x1, t), mix(y0, y1, t)];
    };
    // n coups joués entre t0 et t0 + n·d : chaque coup tient sa position, puis glisse vers la suivante
    const etape = (pr, t0, d, n) => {
        const x = (pr - t0) / d;
        if (x <= 0) return 0;
        const k = Math.floor(x);
        return k >= n ? n : k + lisse(0.3, 0.9, x - k);
    };
    const offre = fermeture.querySelector('.offre');

    const debut = performance.now();
    let avant = 0;
    function animer(now) {
        const temps = (now - debut) / 1000;
        const dt = Math.min(0.1, (now - (avant || now)) / 1000);
        avant = now;
        if (!calme) jouerLecteurs(dt);
        scenes.forEach((s) => {
            if (s.visible === false) return;
            // la boîte se tourne au doigt ou à la souris (45° de chaque côté ; son dos ne se voit pas) et revient
            // d'elle-même de face
            if (!s.tenue) { s.doigt *= Math.exp(-dt * 3); s.vitesse = 0; }
            s.doigt = borne(s.doigt, -45, 45);
            poser(s, s.t, temps);
        });
        if (!calme) requestAnimationFrame(animer);
    }

    // ======================= Point 3 : une partie à 4, vue de dessus =======================
    // Même vue que les échecs (Hugo, 17/11 : la partie filmée qui tournait se lisait mal). Les équipes de départ et
    // les 7 coups de ../jeu/video/src/Partie.tsx (Sud, Ouest, Nord, Est), puis « MATATAK ! » : KRAK met SHANS en échec.
    // [id, carte, face, col (0 = a), rang (0 = 1), rotation vers son joueur]
    const DEPART4 = [
        ['mojo', '04-mojo', 'clair', 4, 0, 0], ['dysko', '13-dysko', 'clair', 5, 0, 0],
        ['banjo-d', '19-banjo', 'clair', 3, 1, 0], ['banjo-e', '19-banjo', 'clair', 4, 1, 0],
        ['azar', '01-azar', 'clair', 3, 7, 180], ['krak', '10-krak', 'clair', 2, 7, 180],
        ['tamtam-e', '35-tamtam', 'clair', 4, 6, 180], ['tamtam-d', '35-tamtam', 'clair', 3, 6, 180],
        ['shans', '02-shans', 'sombre', 0, 3, 90], ['rokk', '26-rokk', 'sombre', 0, 2, 90],
        ['shasha-b5', '33-shasha', 'sombre', 1, 4, 90], ['shasha-b4', '33-shasha', 'sombre', 1, 3, 90],
        ['karma', '03-karma', 'sombre', 7, 4, -90], ['frank', '11-frank', 'sombre', 7, 5, -90],
        ['bongo-g4', '34-bongo', 'sombre', 6, 3, -90], ['bongo-g5', '34-bongo', 'sombre', 6, 4, -90],
    ];
    // [id, col, rang, carte prise]
    const COUPS4 = [
        ['banjo-e', 5, 2], ['shasha-b4', 2, 3], ['tamtam-e', 4, 4], ['bongo-g4', 4, 5],
        ['dysko', 3, 2], ['rokk', 3, 2, 'dysko'], ['krak', 2, 3, 'shasha-b4'],
    ];
    // Cartes des plateaux (partie à 4, échiquier) : posées en a8 par le CSS, déplacées par transform (en % de la carte :
    // une case = 12,5 % du plateau = 12,5 / 11 de la carte) ; plus de left / top, qui refaisaient la mise en page à
    // chaque image (revue des animations, 19/11)
    const CASE_CARTE = 12.5 / 11 * 100;
    const partie4 = document.querySelector('.partie4');
    const pointPartie = partie4 && partie4.closest('.point-partie');
    const pieces4 = [];
    const cri4 = partie4 && partie4.parentElement.querySelector('.cri');
    if (cri4) partie4.appendChild(cri4); // posé sur le plateau, au-dessus de KRAK
    // la flèche de l'échec : de KRAK (c4) vers SHANS (a4), sur la même rangée ; coordonnées du plateau en 800 × 800
    let fleche4 = null;
    if (partie4) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'fleche-echec'); svg.setAttribute('viewBox', '0 0 800 800'); svg.setAttribute('aria-hidden', 'true');
        const ligne = document.createElementNS(NS, 'line'), tete = document.createElementNS(NS, 'path');
        tete.setAttribute('d', 'M0 0L26 -17L26 17Z'); // pointe vers la gauche
        svg.append(ligne, tete);
        partie4.appendChild(svg);
        fleche4 = { svg, ligne, tete };
    }
    if (partie4) {
        DEPART4.forEach(([id, carte, face, col, rang, rot]) => {
            const im = document.createElement('img');
            im.src = `${partie4.dataset.cartes}/${face}/${carte}.webp`; im.alt = ''; im.loading = 'lazy';
            partie4.insertBefore(im, partie4.firstChild);
            pieces4.push({ id, im, col, rang, rot });
        });
    }
    function poserPartie4(t) {
        const etat = new Map(pieces4.map((pc) => [pc.id, { col: pc.col, rang: pc.rang, saut: 0, envol: 0, bouge: false }]));
        COUPS4.forEach(([id, c1, r1, prise], k) => {
            const a = 0.04 + k * 0.11;
            const f = lisse(a, a + 0.08, t), e = etat.get(id);
            e.col = mix(e.col, c1, f); e.rang = mix(e.rang, r1, f);
            e.saut = Math.max(e.saut, Math.sin(Math.PI * f));
            if (f > 0 && f < 1) e.bouge = true;
            // la carte prise s'envole quand l'attaquant arrive
            if (prise) etat.get(prise).envol = lisse(a + 0.05, a + 0.09, t);
        });
        pieces4.forEach((pc) => {
            const e = etat.get(pc.id), im = pc.im;
            ecrire(im, 'opacity', (1 - e.envol).toFixed(3));
            ecrire(im, 'visibility', e.envol >= 1 ? 'hidden' : '');
            ecrire(im, 'transform', `translate(${(e.col * CASE_CARTE).toFixed(2)}%, ${((7 - e.rang) * CASE_CARTE - 90 * e.envol).toFixed(2)}%) rotate(${pc.rot + 25 * e.envol}deg) scale(${(1 + e.saut * 0.25 + e.envol * 0.3).toFixed(3)})`);
            // la carte qui bouge passe au-dessus de toutes ; pas « saut > 0 » : sin(π) vaut 1e-16, et une carte déjà jouée
            // (TAMTAM) restait au-dessus de celle qui sautait par-dessus (BONGO) (Hugo, 23/11)
            ecrire(im, 'zIndex', e.bouge ? 3 : e.envol > 0 ? 2 : 1);
        });
        // le cri se pose en 0,45 s, sortie douce (pas de rebond : Hugo, 24/11)
        ecrire(partie4.parentElement, '--cri', (1 - (1 - borne((t - 0.84) / 0.05)) ** 3).toFixed(3));
        // (Hugo, 23/11) le cri au-dessus de KRAK, qui met l'échec, et SHANS en échec : liseré rouge qui pulse et secousse,
        // comme sur le site (chessground.css)
        // centré entre KRAK et SHANS, sous la flèche (rangée du dessous, vide à ce moment de la partie)
        const krak = etat.get('krak'), shansE = etat.get('shans');
        // (Hugo, 24/11 : il touchait le liseré rouge de SHANS) un peu à droite et au milieu de la rangée du dessous
        ecrire(cri4, 'left', `${(((krak.col + shansE.col) / 2 + 0.62) * 12.5).toFixed(2)}%`);
        ecrire(cri4, 'top', `${((7 - krak.rang + 1.5) * 12.5).toFixed(2)}%`);
        const shans = pieces4.find((pc) => pc.id === 'shans');
        if (shans) shans.im.classList.toggle('echec', t >= 0.84);
        // la flèche pousse de KRAK vers SHANS pendant que le cri arrive
        if (fleche4) {
            const s4 = etat.get('shans'), y = (7 - krak.rang + 0.5) * 100;
            const x0 = (krak.col + 0.5) * 100 - 50, x1 = (s4.col + 0.5) * 100 + 58; // des bords des cartes
            const f = lisse(0.84, 0.9, t), xt = mix(x0, x1, f);
            ecrire(fleche4.svg, 'opacity', f > 0 ? '1' : '0');
            ['x1', 'y1', 'x2', 'y2'].forEach((k, i) => {
                const v = [x0, y, xt + 20, y][i].toFixed(1);
                if (fleche4.ligne.getAttribute(k) !== v) fleche4.ligne.setAttribute(k, v);
            });
            const tr = `translate(${xt.toFixed(1)} ${y.toFixed(1)})`;
            if (fleche4.tete.getAttribute('transform') !== tr) fleche4.tete.setAttribute('transform', tr);
        }
    }
    if (partie4) poserPartie4(0);

    // ======================= Lecteurs : les animations se jouent seules (23/11) =======================
    // Retours de visiteurs (Hugo, 23/11) : piloter une animation au doigt n'est pas intuitif (un geste rapide la saute,
    // un geste lent fait croire que la page rame). Chaque animation se lance quand sa section est au milieu de l'écran
    // (voir jouerLecteurs), se met en pause hors de l'écran ; jamais à l'envers. Finie, elle reste sur sa dernière
    // image et sa « suite » (une boucle) tourne tant qu'elle est à l'écran. Quitter la section et y revenir la relance
    // depuis le début (Hugo : à la place d'un bouton ↻).
    // Textes (texte: true, Hugo 23/11) : ils ne font pas partie des animations ; ils se dévoilent dès qu'ils arrivent à
    // l'écran, sans attendre une autre animation, et s'affichent en entier si on les quitte avant la fin (on ne rate
    // rien en descendant vite) ; ils ne se rejouent pas.
    // poser(p) : p de 0 à 1 ; suite(t) : secondes depuis la fin.
    const lecteurs = [];
    const ioLecteurs = new IntersectionObserver((es) => es.forEach((e) => {
        const L = e.target._lecteur;
        L.visible = e.isIntersecting;
        if (e.isIntersecting) {
            // de retour après être sorti : on repart du début (pas les textes)
            if (L.sorti && !L.texte && L.etat !== 'attente') { L.ecoule = 0; L.depuisFin = 0; L.etat = 'attente'; L.cible.classList.remove('rejouable'); L.poser(0); }
            L.sorti = false; L.vu = true;
        } else if (L.vu) {
            L.sorti = true;
            if (L.texte && L.etat !== 'fini') { L.etat = 'fini'; L.poser(1); }
        }
    }));
    // cible : l'image animée qu'on touche pour la rejouer une fois finie (Hugo, 23/11) ; pas les textes
    function lecteur(el, { duree, poser, suite, siCalme, texte, cible }) {
        const L = { el, duree, poser, suite, texte, ecoule: 0, depuisFin: 0, etat: 'attente', visible: false, cible: cible || el };
        el._lecteur = L;
        lecteurs.push(L);
        if (calme) { if (siCalme) siCalme(); else poser(1); return L; }
        poser(0);
        ioLecteurs.observe(el);
        if (!texte) {
            // un toucher qui glisse (défilement, boîte tournée au doigt) ne compte pas
            let x0 = 0, y0 = 0;
            L.cible.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
            L.cible.addEventListener('click', (e) => {
                if (L.etat !== 'fini' || Math.hypot(e.clientX - x0, e.clientY - y0) > 10) return;
                if (e.target.closest('a, button')) return;
                L.ecoule = 0; L.depuisFin = 0; L.etat = 'joue';
                L.cible.classList.remove('rejouable');
                L.poser(0);
            });
        }
        return L;
    }
    // Flèche « suite » (Hugo, 24/11) : une animation qui occupe l'écran vient de finir → on invite à descendre ; elle part
    // dès qu'on défile de 40 px ; pas après la boîte de fin. Un toucher descend à la section suivante.
    const suiteBas = document.querySelector('.suite-bas');
    let ySuite = null, suiteDe = null;
    function montrerSuite(L) {
        if (!suiteBas || (fermeture && fermeture.contains(L.el))) return;
        const h = window.innerHeight;
        const r = L.el.getBoundingClientRect(); // à l'écran pour l'essentiel (un petit graphique compte aussi)
        if (partVisible(r, h) < Math.min(h / 3, r.height * 0.8) || window.scrollY < 60) return;
        ySuite = window.scrollY; suiteDe = L.el;
        suiteBas.classList.add('visible');
    }
    function cacherSuite() { ySuite = null; if (suiteBas) suiteBas.classList.remove('visible'); }
    if (suiteBas) suiteBas.addEventListener('click', () => {
        const suivante = [...document.querySelectorAll('header.ouverture, section, article.point, footer')]
            .filter((el) => !(suiteDe && el.contains(suiteDe))) // pas la section de l'animation qui vient de finir
            .map((el) => [el, el.getBoundingClientRect().top]).filter(([, t]) => t > 90).sort((a, b) => a[1] - b[1])[0];
        cacherSuite();
        if (suivante) window.scrollTo({ top: window.scrollY + suivante[1] - (window.innerWidth > 820 ? 70 : 0), behavior: 'smooth' });
    });
    // part de l'écran (px) occupée par un élément
    const partVisible = (r, h) => Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
    function jouerLecteurs(dt) {
        // Départ d'une animation (Hugo, 23/11 : le graphique partait pendant les freins, sans qu'il le voie) : le milieu
        // de la section est entre 15 % et 70 % de la hauteur de l'écran (ou elle en occupe 60 %), et aucune autre
        // animation en cours n'occupe encore plus d'un tiers de l'écran. Un texte part dès que son haut passe 85 %.
        const prets = lecteurs.filter((L) => L.visible && L.etat === 'attente');
        if (prets.length) {
            const h = window.innerHeight;
            const occupe = lecteurs.some((L) => !L.texte && L.visible && L.etat === 'joue' && partVisible(L.el.getBoundingClientRect(), h) > h / 3);
            prets.forEach((L) => {
                const r = L.el.getBoundingClientRect(), c = (r.top + r.bottom) / 2;
                if (L.texte ? r.top < h * 0.85 && r.bottom > 0
                    : !occupe && ((c > h * 0.15 && c < h * 0.7) || partVisible(r, h) >= h * 0.6)) L.etat = 'joue';
            });
        }
        lecteurs.forEach((L) => {
            if (!L.visible) return;
            if (L.etat === 'joue') {
                L.ecoule += dt;
                const p = L.duree ? borne(L.ecoule / L.duree) : 1;
                L.poser(p);
                if (p >= 1) { L.etat = 'fini'; if (!L.texte) { L.cible.classList.add('rejouable'); montrerSuite(L); } }
            } else if (L.etat === 'fini' && L.suite) {
                L.depuisFin += dt;
                L.suite(L.depuisFin);
            }
        });
    }
    // Textes qui se dévoilent un à un (l'équipe, les freins, Toujours un adversaire…)
    const enVague = (el, items, duree) => {
        if (!el || !items.length) return;
        const n = items.length;
        lecteur(el, {
            duree, texte: true,
            poser: (p) => items.forEach((it, i) => {
                const a = lisse(i / n, (i + 1) / n, p);
                // arrivé : plus de style posé (un bouton garde son effet au toucher)
                ecrire(it, 'opacity', a >= 1 ? '' : a.toFixed(3));
                ecrire(it, 'transform', a >= 1 ? '' : `translateY(${((1 - a) * 18).toFixed(1)}px)`);
            }),
        });
    };
    // temps (s) → progression de l'ancienne animation au défilement, par segments : [[t, p], …] croissants
    const surCourbe = (pts, t) => {
        if (t <= pts[0][0]) return pts[0][1];
        for (let k = 1; k < pts.length; k++) {
            const [t1, p1] = pts[k];
            if (t <= t1) { const [t0, p0] = pts[k - 1]; return mix(p0, p1, (t - t0) / (t1 - t0)); }
        }
        return pts[pts.length - 1][1];
    };

    // ======================= Échecs : les cartes se posent, puis une ouverture se joue =======================
    const echecs = document.getElementById('echecs');
    const echiquier = echecs && echecs.querySelector('.echiquier-mt');
    let piecesEchecs = [];
    if (echiquier) {
        const dossier = echiquier.dataset.cartes;
        // Roi MOJO / KARMA, Dame FUNK, Tours ROKK, Fous FOLK, Cavaliers SALSA, Pions les Suricates (livret, page 11)
        const ligne = ['26-rokk', '24-salsa', '14-folk', '07-funk', null, '14-folk', '24-salsa', '26-rokk'];
        const ajouter = (nom, face, col, rang, i) => {
            const im = document.createElement('img');
            im.src = `${dossier}/${face}/${nom}.webp`; im.alt = ''; im.loading = 'lazy';
            echiquier.appendChild(im);
            piecesEchecs.push({ im, col, rang, i, noir: face === 'sombre' });
        };
        for (let col = 0; col < 8; col++) {
            ajouter(ligne[col] || '04-mojo', 'clair', col, 0, col);
            ajouter(col % 2 ? '42-zag' : '39-zyg', 'clair', col, 1, 8 + col);
            ajouter(col % 2 ? '40-zwang' : '41-zug', 'sombre', col, 6, 16 + col);
            ajouter(ligne[col] || '03-karma', 'sombre', col, 7, 24 + col);
        }
    }
    // 1. e4 e5 2. Cf3 Cc6 3. Fc4
    const COUPS = [[4, 1, 4, 3], [4, 6, 4, 4], [6, 0, 5, 2], [1, 7, 2, 5], [5, 0, 2, 3]];
    function poserEchecs(pe) {
        piecesEchecs.forEach((pc) => {
            let col = pc.col, rang = pc.rang, saut = 0, bouge = false;
            COUPS.forEach(([c0, r0, c1, r1], k) => {
                if (col === c0 && rang === r0) {
                    const f = lisse(0.6 + k * 0.07, 0.66 + k * 0.07, pe);
                    col = mix(c0, c1, f); rang = mix(r0, r1, f); saut = Math.max(saut, Math.sin(Math.PI * f));
                    if (f > 0 && f < 1) bouge = true;
                    if (f >= 1) { col = c1; rang = r1; }
                }
            });
            const arrive = lisse(0.04 + pc.i * 0.014, 0.12 + pc.i * 0.014, pe);
            // les cartes arrivent de leur côté du plateau (Blancs en bas, Noirs en haut)
            const dy = (1 - arrive) * (pc.noir ? -260 : 260);
            ecrire(pc.im, 'opacity', arrive);
            ecrire(pc.im, 'transform', `translate(${(col * CASE_CARTE).toFixed(2)}%, ${((7 - rang) * CASE_CARTE + dy).toFixed(2)}%) rotate(${(pc.noir ? 180 : 0) + (1 - arrive) * (pc.noir ? -40 : 40)}deg) scale(${1 + saut * 0.25})`);
            ecrire(pc.im, 'zIndex', bouge ? 2 : 1);
        });
    }

    // ======================= Freins (une fois), puis point 1 (MOJO, en boucle) =======================
    // pr = progression de l'ancienne animation au défilement (0 → 1,03), qui allait des freins au point 1. Repères :
    // 0,03 → 0,42 une ouverture d'échecs, toutes les flèches des coups possibles à chaque position ;
    // les 3 freins arrivent (0,05 / 0,17 / 0,29), sont barrés (0,40 → 0,49), s'en vont (0,5 → 0,54) ;
    // 0,5 → 0,62 le plateau de MATATAK arrive de la droite et pousse l'échiquier, qui part en tournoyant ;
    // le logo remplace le titre et le point 1 arrive (0,58) ; MOJO avance (0,62), zoom sur sa carte (0,64 → 0,73),
    // on recule (0,79 → 0,9) et les flèches sortent de ses symboles (0,79 → 0,92).
    // (19/11 : le point 1 après le plateau, de 0,63 à 0,68, et la suite décalée d'autant)
    // (23/11, Hugo) les freins ne sont plus barrés et le plateau de MATATAK ne pousse plus l'échiquier : après les 3
    // freins, une phrase mène aux 4 points ; le point 1 (sa section) repart du plateau entier (0,62 → 1,03, sur vueP1)
    function poserFreins(pr) {
        const fe = etape(pr, 0.03, 0.065, 6);
        const vues = lisse(0.01, 0.06, pr);
        // fondu long entre deux positions : les flèches de l'une laissent la place à celles de la suivante sans à-coup
        coupsFreins.forEach((g, j) => { ecrire(g, 'opacity', (vues * borne(1 - Math.abs(fe - j) * 1.6)).toFixed(3)); });
        piecesFreins.forEach((p) => {
            const [x, y] = surChemin(p.c, fe);
            const tr = `translate(${(x * 100).toFixed(1)} ${((7 - y) * 100).toFixed(1)})`;
            if (p.el._tr !== tr) { p.el._tr = tr; p.el.setAttribute('transform', tr); }
        });
    }
    function poserPoint1(pr, boucle) {
        // les autres cartes s'effacent, MOJO avance de e1 à e2, on zoome sur sa carte (× 9 : on ne voit presque plus que lui, Hugo 16/11 ; régulier en échelle log),
        // puis on recule (× 2,6) pendant que des flèches sortent de ses symboles jusqu'à ses 8 cases
        // caméra : la vue fait 9 fois le plateau, réduite d'autant (zoom sv ≤ 9), et centre peu à peu MOJO (f)
        const zin = lisse(0.72, 0.81, pr);
        const sv = Math.exp(Math.log(9) * zin + (Math.log(3.1) - Math.log(9)) * lisse(0.9, 1, pr)); // 3,1 : la Colline reste hors de la vue (Hugo, 23/11)
        const vx = (0.5 - sv * (0.5 + zin * 0.0625)) * 100 / 9, vy = (0.5 - sv * (0.5 + zin * 0.3125)) * 100 / 9;
        ecrire(vueP1, 'transform', `translate(${vx.toFixed(3)}%, ${vy.toFixed(3)}%) scale(${(sv / 9).toFixed(4)})`);
        // les autres cartes s'effacent ; MOJO avance d'une case (12,5 % de la vue = 116,8 % de sa carte)
        const efface = (1 - lisse(0.69, 0.74, pr)).toFixed(3);
        cartesMt.forEach((im) => ecrire(im, 'opacity', efface));
        ecrire(vedetteMt, 'transform', `translateY(${(-116.82 * lisse(0.7, 0.75, pr)).toFixed(2)}%)`);
        // les symboles de la carte brillent trois fois (ils clignotent), puis les flèches en sortent
        const brille = boucle ? boucle.brille : Math.abs(Math.sin(3 * Math.PI * lisse(0.8, 0.93, pr)));
        const vu = Math.min(1, brille * 3).toFixed(3);
        lueursMt.forEach((l) => {
            ecrire(l, 'opacity', vu);
            ecrire(l, 'transform', `scale(${(1 + brille * 0.3).toFixed(3)})`);
        });
        halosMt.forEach((l) => {
            ecrire(l, 'opacity', (brille * 0.85).toFixed(3));
            ecrire(l, 'transform', `scale(${(0.7 + brille * 0.4).toFixed(3)})`);
        });
        // les flèches poussent pendant qu'on recule
        const pousse = boucle ? boucle.pousse : lisse(0.92, 1.03, pr);
        flechesMt.forEach((f) => {
            ecrire(f.g, 'opacity', (Math.min(1, pousse * 5) * (boucle ? boucle.vu : 1)).toFixed(3));
            ecrire(f.ligne, 'strokeDashoffset', ((1 - pousse) * f.l).toFixed(2));
            ecrire(f.tete, 'transform', `translateX(${(pousse * f.l).toFixed(2)}px)`);
        });
    }
    // Freins : l'ouverture d'échecs se joue (6 s) ; les 3 freins et la phrase sont du texte, à part (Hugo, 23/11)
    const TEMPS_FREINS = [[0, 0], [5.4, 0.4], [6, 0.42]];
    enVague(freins.querySelector('.freins-texte'), [...freinsLi, freins.querySelector('.transition-freins')], 2.4);
    // la vue du plateau de la copie du point 1 part entière ; celui des freins reste caché (vitrine.css)
    ecrire(freinsVue, 'transform', 'translate(0%, 0%) scale(0.1111)');
    lecteur(freins, {
        cible: freinsScene,
        duree: 6,
        poser: (p) => poserFreins(surCourbe(TEMPS_FREINS, p * 6)),
        siCalme: () => poserFreins(0.42),
    });
    // Point 1 : le plateau entier un instant, les autres cartes s'effacent, MOJO avance, zoom, ses symboles brillent,
    // on recule et les flèches sortent ; puis en boucle (5,2 s) : on laisse regarder (2 s), les flèches s'effacent,
    // les symboles brillent trois fois, les flèches ressortent.
    const logoP1 = point1.querySelector('.logo-mt');
    // Arrivée du logo (Hugo, 23/11 : « plus d'impact que de rebond ») : il tombe de plus grand (× 1,9, transparent) en
    // accélérant et frappe sa place en 0,32 s ; à l'impact il s'écrase un peu, tremble et lance un éclat doré qui retombe
    // (0,4 s). Les styles posés sont retirés à la fin.
    function poserLogoP1(t) {
        const CHUTE = 0.32, APRES = 0.4;
        if (t >= CHUTE + APRES) { ['opacity', 'transform', 'filter'].forEach((k) => ecrire(logoP1, k, '')); ecrire(logoP1, '--m', '1'); return; }
        let echelle, dx = 0, eclat = 0;
        if (t < CHUTE) {
            const a = t / CHUTE;
            echelle = 1.9 - 0.9 * a * a * a; // accélère jusqu'au choc
            ecrire(logoP1, 'opacity', borne(a * 2.5).toFixed(3));
        } else {
            const b = (t - CHUTE) / APRES; // 0 → 1 après le choc
            const amorti = Math.exp(-6 * b);
            echelle = 1 - 0.06 * amorti * Math.cos(b * 9); // écrasé au choc, revient vite
            dx = 6 * amorti * Math.sin(b * 38); // tremble
            eclat = amorti;
            ecrire(logoP1, 'opacity', '1');
        }
        ecrire(logoP1, 'transform', `translateX(${dx.toFixed(1)}px) scale(${echelle.toFixed(4)})`);
        ecrire(logoP1, 'filter', `drop-shadow(0 6px ${(24 + 30 * eclat).toFixed(1)}px rgba(234, 196, 90, ${(0.25 + 0.65 * eclat).toFixed(3)}))`);
    }
    const TEMPS_POINT1 = [[0, 0.62], [1.2, 0.69], [2.2, 0.75], [3.2, 0.81], [4.2, 0.9], [5.4, 1.03]];
    lecteur(point1, {
        cible: point1.querySelector('.scene-point1'),
        duree: 5.4,
        poser: (p) => { poserLogoP1(p * 5.4); poserPoint1(surCourbe(TEMPS_POINT1, p * 5.4)); },
        // (Hugo, 23/11) plus de boucle : les flèches s'effaçaient d'un coup ; on reste sur la fin, flèches affichées
        siCalme: () => poserPoint1(1.03),
    });

    // ======================= Point 2 : le graphique se trace une fois =======================
    const graphe = document.querySelector('.graphe');
    if (graphe) lecteur(graphe, { duree: 3.2, poser: (p) => ecrire(graphe, '--p', p.toFixed(3)) });

    // ======================= Point 3 : la partie à 4, jouée une fois (7 coups, puis « MATATAK ! ») =======================
    if (partie4) lecteur(pointPartie, { duree: 9, cible: partie4.parentElement, poser: (p) => poserPartie4(p) });

    // ======================= Point 4 : les bandeaux de cartes défilent en continu =======================
    // (Hugo, 23/11 : l'aller-retour sautait au départ) chaque rangée défile toujours dans le même sens (une sur deux en
    // sens contraire) ; elle est suivie d'une copie d'elle-même : une carte qui sort d'un côté revient de l'autre.
    // Le temps n'avance que pendant que la section est à l'écran, sans jamais repartir de zéro (pas de saut).
    const rangees4 = [...document.querySelectorAll('.point-cartes .rangee')];
    rangees4.forEach((r) => [...r.children].forEach((c) => r.appendChild(c.cloneNode(true))));
    let periodes4 = null; // largeur d'une copie, par rangée (0 : rangée cachée à cette taille d'écran)
    let tBandeaux = 0, dernierB = 0;
    const poserBandeaux = () => {
        if (!periodes4) periodes4 = rangees4.map((r) => (r.offsetWidth + (parseFloat(getComputedStyle(r).columnGap) || 0)) / 2);
        const v = Math.max(24, window.innerWidth * 0.022); // px par seconde
        rangees4.forEach((r, k) => {
            const W = periodes4[k];
            if (!W) return;
            const d = (tBandeaux * v) % W;
            ecrire(r, '--x', `${(r.style.getPropertyValue('--sens').trim() === '-1' ? -d : d - W).toFixed(1)}px`);
        });
    };
    const pointCartes = document.querySelector('.point-cartes');
    // texte: true : décor, part dès qu'il arrive sans attendre la partie à 4, et ne repart pas de zéro au retour
    if (pointCartes) lecteur(pointCartes, {
        duree: 0, texte: true,
        poser: () => poserBandeaux(),
        suite: (t) => { tBandeaux += t >= dernierB ? t - dernierB : t; dernierB = t; poserBandeaux(); },
        siCalme: () => {},
    });

    // ======================= Échecs : les 32 cartes se posent, puis 1. e4 e5 2. Cf3 Cc6 3. Fc4 (une fois) =======================
    const TEMPS_ECHECS = [[0, 0], [3.6, 0.56], [4.2, 0.6], [8.6, 0.95]];
    if (echiquier) lecteur(echecs, {
        cible: echiquier,
        duree: 8.6,
        poser: (p) => poserEchecs(surCourbe(TEMPS_ECHECS, p * 8.6)),
        siCalme: () => poserEchecs(0.6),
    });

    // ======================= Toujours un adversaire : une vraie partie filmée, jouée une fois =======================
    // (23/11, Hugo) le joueur du bas touche ses cartes, joue, l'adversaire répond… jusqu'au Roi sur la Colline. La vidéo
    // part quand le téléphone est au milieu de l'écran, s'arrête hors de l'écran, repart au retour. Le texte (titre,
    // sujets, bouton) se dévoile à part, dès qu'il arrive.
    const partieVideo = enLigne && enLigne.querySelector('.partie-video');
    if (partieVideo) {
        lecteur(enLigne.querySelector('.telephone'), {
            duree: 30, // ≈ la vidéo (29,9 s) ; elle va de toute façon jusqu'au bout
            poser: (p) => {
                if (p === 0) { partieVideo.pause(); partieVideo.currentTime = 0; }
                else if (partieVideo.paused && !partieVideo.ended) partieVideo.play().catch(() => {});
            },
            siCalme: () => {},
        });
        new IntersectionObserver((es) => { if (!es[0].isIntersecting) partieVideo.pause(); }).observe(partieVideo);
    }

    const texteEnLigne = enLigne && enLigne.querySelector('.en-ligne-texte');
    if (texteEnLigne) enVague(texteEnLigne, [...texteEnLigne.children].flatMap((c) => (c.matches('.sujets') ? [...c.children] : [c])), 2);

    // ======================= Fin de page : la boîte fermée s'ouvre en vue d'ensemble, puis l'offre (une fois) =======================
    let finBoite = calme ? 1 : 0;
    // feuilles fixes : claires en haut (ordinateur), puis assombries ; elles reviennent sur la boîte de fin (téléphone)
    function majFeuilles(y, h) {
        const finF = lisse(0.3, 0.62, finBoite);
        // le vignettage aussi : la fin répond au début (Hugo, 17/11)
        const sombre = lisse(0, h * 0.9, y);
        // ordinateur : elles restent assombries à la fin, la boîte ouverte ressort mieux sur le noir (Hugo, 18/11)
        ecrire(feuilles, 'opacity', (etroit() ? finF * 0.6 : mix(0.6, 0.4, sombre)).toFixed(3)); // 0,6 en haut (Hugo, 18/11 : la boîte ressort mieux)
        ecrire(feuilles, '--v', (etroit() ? finF : mix(1 - sombre, 1, finF)).toFixed(3));
    }
    function poserFermeture(pf) {
        finBoite = pf;
        majFeuilles(window.scrollY, window.innerHeight);
        // (18/11, Hugo : sans le rangement) la boîte arrive fermée et s'ouvre aussitôt en vue d'ensemble (0,04 → 0,6)
        if (sceneFermeture) { sceneFermeture.t = 0; sceneFermeture.vue = lisse(0.04, 0.6, pf); }
        fermeture.classList.toggle('vue', pf > 0.1);
        const montre = lisse(0.56, 0.7, pf);
        // sur téléphone, la scène occupe tout l'écran puis remonte pour laisser venir l'offre, un peu avant elle
        if (sceneFermeture) sceneFermeture.offre = lisse(0.48, 0.62, pf);
        ecrire(offre, 'opacity', montre);
        ecrire(offre, 'transform', `translateY(${(1 - montre) * 30}px)`);
        offre.classList.toggle('visible', montre > 0.5);
    }
    const TEMPS_FIN = [[0, 0], [0.3, 0.04], [4.3, 0.6], [5.3, 0.75]];
    lecteur(fermeture, {
        cible: sceneFermeture ? sceneFermeture.el : fermeture,
        duree: 5.3,
        poser: (p) => poserFermeture(surCourbe(TEMPS_FIN, p * 5.3)),
        siCalme: () => poserFermeture(1),
    });

    // ======================= Équipe : chaque partie se dévoile une fois (Hugo, 23/11) =======================
    // l'équipe (les 3 portraits un à un, puis la phrase), la genèse qui s'écrit, « Ils nous font confiance » (titre puis
    // logos), « Fabriqué en Europe » (titre, les 3 points un à un comme les freins, puis le label)
    const equipeTrois = document.querySelector('.equipe-trois');
    if (equipeTrois) enVague(equipeTrois, [...equipeTrois.querySelectorAll('.portrait, .intro')], 2);
    const soutien = document.querySelector('.equipe-bloc .soutien');
    if (soutien) enVague(soutien, [...soutien.querySelectorAll('h3, figure')], 1.5);
    const fabrication = document.querySelector('.equipe-bloc .fabrication');
    if (fabrication) enVague(fabrication, [...fabrication.querySelectorAll('h3, li, .label')], 3);
    // la genèse s'écrit mot à mot (≈ 22 mots par seconde) : l'opacité de chaque mot est écrite sur lui
    const genese = document.querySelector('.genese');
    if (genese) {
        const couper = (noeud) => [...noeud.childNodes].forEach((c) => {
            if (c.nodeType === 3) {
                const frag = document.createDocumentFragment();
                c.textContent.split(/(\s+)/).forEach((m) => {
                    if (!m) return;
                    if (/^\s+$/.test(m)) { frag.append(m); return; }
                    const sp = document.createElement('span');
                    sp.className = 'mot-g'; sp.textContent = m;
                    frag.append(sp);
                });
                c.replaceWith(frag);
            } else if (c.nodeType === 1) couper(c);
        });
        genese.querySelectorAll('p, footer').forEach(couper);
        const mots = [...genese.querySelectorAll('.mot-g')], n = mots.length;
        lecteur(genese, {
            duree: n / 22, texte: true,
            poser: (q) => mots.forEach((m, k) => ecrire(m, 'opacity', borne((q * (n + 3) - k) / 3).toFixed(2))),
        });
    }

    // ======================= Barre de progression (Hugo, 19/11) =======================
    // Un trait fin en haut de l'écran, une case par section, qui se remplit quand la section passe au milieu de
    // l'écran : on sait où on en est. Seulement transform (scaleX) : rien à recalculer pour la page.
    const progression = document.createElement('div');
    progression.className = 'progression';
    progression.setAttribute('aria-hidden', 'true');
    const etapesBarre = ['freins', 'comment', 'echecs', 'en-ligne', 'temoins', 'equipe', 'boite']
        .map((id) => document.getElementById(id)).filter(Boolean)
        .map((section) => { const i = document.createElement('i'), b = document.createElement('b'); i.appendChild(b); progression.appendChild(i); return { section, b }; });
    document.body.appendChild(progression);

    // ======================= Défilement =======================
    // Toutes les mesures d'abord, puis les écritures (Safari iPhone saccadait quand elles se mêlaient, 19/11)
    let attente = false;
    function maj() {
        attente = false;
        const y = window.scrollY, h = window.innerHeight;
        // --- mesures ---
        const rF = fermeture.getBoundingClientRect(), hautFermeture = fermeture.offsetTop;
        const remplis = etapesBarre.map(({ section }) => { const r = section.getBoundingClientRect(); return borne((h * 0.5 - r.top) / r.height); });
        // --- écritures ---
        etapesBarre.forEach(({ b }, k) => ecrire(b, 'transform', `scaleX(${remplis[k].toFixed(3)})`));
        // cachée sur le premier écran, et quand la boîte de fin commence à partir (Hugo, 19/11)
        progression.classList.toggle('visible', y > h * 0.5 && rF.bottom > h);
        // la boîte de fin est à moins de 3 écrans : ses images se chargent maintenant
        if (sceneFermeture && rF.top < h * 3) prechargerScene(sceneFermeture);
        nav.classList.toggle('plein', y > 40);
        if (descendre) descendre.classList.toggle('partie', y > 60 || !placeDescendre);
        if (ySuite !== null && Math.abs(y - ySuite) > 40) cacherSuite();
        // la barre « Jouer » du bas se cache pendant l'animation de la boîte (elle cacherait les légendes et l'offre)
        collante.classList.toggle('visible', y > h * 0.8 && y < hautFermeture - h * 0.3);
        if (!calme && y < h * 1.2) ecrire(fond, 'transform', `translateY(${y * 0.25}px) scale(${1 + y / 5000})`);
        if (sceneHeros) sceneHeros.t = 0;

        majFeuilles(y, h);

        if (calme) animer(performance.now());
    }
    window.addEventListener('scroll', () => {
        if (!attente) { attente = true; requestAnimationFrame(maj); }
    }, { passive: true });
    window.addEventListener('resize', () => { scenes.forEach((s) => { s.pose = false; }); periodes4 = null; maj(); }, { passive: true });
    // (23/11) plus de molette ralentie : elle servait au pilotage des animations au défilement, la page défile
    // maintenant comme les autres

    maj();
    requestAnimationFrame(animer);

    // ======================= Carte vedette =======================
    const vedette = document.querySelector('.vedette .carte-rv');
    if (vedette && !calme) {
        const pencher = (x, y) => { ecrire(vedette, '--tx', x.toFixed(1)); ecrire(vedette, '--ty', y.toFixed(1)); };
        vedette.parentElement.addEventListener('pointermove', (e) => {
            const r = vedette.getBoundingClientRect();
            pencher(((e.clientX - r.left) / r.width - 0.5) * 30, -((e.clientY - r.top) / r.height - 0.5) * 24);
        });
        vedette.parentElement.addEventListener('pointerleave', () => pencher(0, 0));
        window.addEventListener('deviceorientation', (e) => {
            if (e.gamma == null) return;
            pencher(borne(e.gamma, -30, 30) * 0.6, borne((e.beta || 45) - 45, -30, 30) * -0.4);
        }, { passive: true });
    }

    // ======================= Point 4 : une carte touchée fait un tour sur elle-même =======================
    // Comme dans la Collection (animation carte-tour) : on voit sa face claire au dos. La face claire n'est chargée
    // qu'au premier toucher.
    document.querySelectorAll('.rangee').forEach((rangee) => rangee.addEventListener('click', (e) => {
        const im = e.target.closest('img[data-carte]');
        if (!im) return;
        let pivote = im.parentElement.classList.contains('pivote') ? im.parentElement : null;
        if (!pivote) {
            const tour = document.createElement('span'); tour.className = 'tour';
            pivote = document.createElement('span'); pivote.className = 'pivote';
            const dos = document.createElement('img');
            dos.className = 'dos'; dos.alt = ''; dos.src = im.src.replace('/sombre/', '/clair/');
            im.replaceWith(tour); tour.appendChild(pivote); pivote.append(im, dos);
        }
        pivote.classList.remove('en-tour');
        void pivote.offsetWidth; // relance l'animation si on retouche la carte pendant son tour
        pivote.classList.add('en-tour');
    }));

    // ======================= Ils y ont joué : boucles muettes, son au choix =======================
    // Une seule vidéo parle à la fois ; activer le son la reprend au début. Hors de l'écran, elle s'arrête.
    const videos = [...document.querySelectorAll('.temoins video')];
    const ecouter = (v, oui) => {
        v.muted = !oui;
        const b = v.parentElement.querySelector('.son');
        b.setAttribute('aria-pressed', String(oui));
        b.setAttribute('aria-label', oui ? 'Couper le son' : 'Activer le son');
    };
    // avec le son : si le navigateur refuse (Safari sans geste), elle repart muette au lieu de rester figée
    const jouer = (v) => v.play().catch(() => { if (!v.muted) { ecouter(v, false); v.play().catch(() => {}); } });
    videos.forEach((v) => {
        v.parentElement.querySelector('.son').addEventListener('click', () => {
            const oui = v.muted;
            videos.forEach((w) => ecouter(w, false));
            if (oui) { ecouter(v, true); v.currentTime = 0; jouer(v); }
        });
        // sous-titres dessinés par la page (même style partout) ; la piste du navigateur reste cachée
        const st = v.parentElement.querySelector('.sous-titre');
        const piste = v.textTracks[0];
        if (piste && st) {
            piste.mode = 'hidden';
            piste.addEventListener('cuechange', () => {
                const c = piste.activeCues && piste.activeCues[0];
                // jamais un signe seul en début de ligne (Hugo, 18/11 : le « ! » passait encore à la ligne sur son
                // téléphone malgré l'espace insécable des .vtt) : le mot et son signe dans un bloc insécable
                st.replaceChildren();
                if (c) c.text.replace(/«\s+/g, '«\u00a0').split(/(\S+[\s\u00a0\u202f]+[!?:;»]+|«\u00a0\S+)/).forEach((m, i) => {
                    if (!m) return;
                    if (i % 2) { const s = document.createElement('span'); s.style.whiteSpace = 'nowrap'; s.textContent = m.replace(/\s+(?=[!?:;»])/g, '\u00a0'); st.append(s); }
                    else st.append(m);
                });
            });
        }
        new IntersectionObserver((es) => {
            if (es[0].isIntersecting) jouer(v);
            else { v.pause(); ecouter(v, false); }
        }, { threshold: 0.6 }).observe(v); // (23/11) 60 % : l'une sous l'autre, rarement deux à la fois
    });

    // ======================= Questions : ouverture et fermeture en douceur (Hugo, 23/11) =======================
    // Les <details> s'ouvraient d'un coup : la hauteur glisse (0,32 s, sortie douce), la réponse arrive en fondu en
    // descendant un peu ; fermeture un peu plus rapide. Un clic pendant le mouvement repart de la hauteur du moment.
    if (!calme) document.querySelectorAll('.faq details').forEach((d) => {
        const sommaire = d.querySelector('summary'), reponse = d.querySelector('summary ~ *');
        if (!reponse) return;
        sommaire.addEventListener('click', (e) => {
            e.preventDefault();
            const ouvrir = !d.open || d._ferme;
            const depart = d.offsetHeight;
            if (d._anim) d._anim.cancel();
            if (d._fondu) d._fondu.cancel();
            d.open = true;
            const bords = d.offsetHeight - d.clientHeight;
            const arrivee = ouvrir ? d.offsetHeight : sommaire.offsetHeight + bords;
            d.style.overflow = 'hidden';
            d.style.boxSizing = 'border-box';
            d._ferme = !ouvrir;
            d.classList.toggle('ferme', !ouvrir); // le chevron tourne tout de suite
            d._anim = d.animate({ height: [`${depart}px`, `${arrivee}px`] },
                { duration: ouvrir ? 320 : 240, easing: ouvrir ? 'cubic-bezier(.2, .8, .2, 1)' : 'cubic-bezier(.4, 0, .2, 1)' });
            d._fondu = reponse.animate(ouvrir ? { opacity: [0, 1], transform: ['translateY(-6px)', 'none'] } : { opacity: [1, 0] },
                { duration: ouvrir ? 320 : 180, easing: 'ease-out', fill: 'both' });
            d._anim.onfinish = () => {
                if (!ouvrir) d.open = false;
                d._ferme = false; d._anim = null;
                d.classList.remove('ferme');
                d.style.overflow = ''; d.style.boxSizing = '';
                if (d._fondu) { d._fondu.cancel(); d._fondu = null; }
            };
        });
    });

    // ======================= Apparition des blocs =======================
    const tout = document.querySelectorAll('.mt-apparait');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('vu'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    tout.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 80 + 'ms'; io.observe(el); });
})();
