// Vitrine (page de vente) : tout ce qui vit au défilement.
// - la boîte en 3D du héros : elle flotte et se penche au doigt (un peu seulement : on ne montre pas son dos) ;
// - en bas de page, la partie est en place sur le plateau ; au défilement les cartes rentrent, le plateau se replie,
//   la boîte se referme et l'offre apparaît ;
// - [data-p] : progression 0 → 1 posée en variable CSS --p quand l'élément traverse l'écran (freins barrés,
//   éventails des Saisons, cartes qui se retournent, Rois qui montent) ;
// - les freins des échecs (section collante) : ils arrivent un à un, sont barrés, s'en vont, la promesse reste ;
// - la partie en 72 images, qui se joue toute seule quand elle est à l'écran, avec un fondu entre images voisines ;
// - la carte vedette, qui suit le doigt ou l'inclinaison du téléphone.
(function () {
    const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = document.getElementById('nav');
    const collante = document.getElementById('collante');
    const fond = document.getElementById('fond');
    const film = document.getElementById('comment');
    const canvas = document.getElementById('scene');
    const ctx = canvas.getContext('2d');
    const borne = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const lisse = (a, b, x) => { const t = borne((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => a + (b - a) * t;
    const etroit = () => window.innerWidth <= 820;

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
        const s = { el, monde, u: 1, doigt: 0, vitesse: 0, tenue: false, t: 0, planes: [] };

        function div(cls, parent) {
            const d = document.createElement('div');
            d.className = cls;
            if (parent) parent.appendChild(d);
            return d;
        }
        // Un plan de l × h mm, centré sur l'origine de son parent, posé par la fonction pose(u) → transform
        function plan(parent, l, h, cls, fond, pose) {
            const d = div('plan ' + (cls || ''), parent);
            if (fond) d.style.backgroundImage = `url("${fond}")`;
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
                if (!dedans) d.style.setProperty('--sombre', { haut: .12, bas: .5, droite: .45, gauche: .3 }[nom]);
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

        // Cale en carton qui divise le fond en 9 cases (prototype de Fabryka), et les piles de cartes rangées dedans
        s.contenu = pivot(s.fond);
        const L = FOND - 4, C = L / 3, HC = 28;
        [-C / 2, C / 2].forEach((d) => {
            plan(s.contenu, L, HC, 'cale', img.paroi, (u) => `translate3d(0,${d * u}px,${HC / 2 * u}px) rotateX(-90deg)`);
            plan(s.contenu, L, HC, 'cale', img.paroi, (u) => `translate3d(${d * u}px,0,${HC / 2 * u}px) rotateY(90deg) rotateZ(90deg)`);
        });
        const DESSUS = ['26-rokk', '13-dysko', '33-shasha', '11-frank', '01-azar', '34-bongo', '24-salsa', '18-jazz', '07-funk'];
        s.cases = [];
        for (let i = 0; i < 9; i++) {
            const cx = ((i % 3) - 1) * C, cy = (Math.floor(i / 3) - 1) * C, n = i % 2 ? 7 : 8, h = n * EPAISSEUR;
            s.cases.push({ cx, cy, h });
            plan(s.contenu, CARTE, CARTE, 'carte', `${img.cartes}/sombre/${DESSUS[i]}.webp`, (u) => `translate3d(${cx * u}px,${cy * u}px,${(h + 0.2) * u}px)`);
            const r = CARTE / 2;
            [[0, r, -90, 'X'], [0, -r, 90, 'X'], [r, 0, 90, 'Y'], [-r, 0, -90, 'Y']].forEach(([dx, dy, a, axe]) => {
                const tour = axe === 'X' ? `rotateX(${a}deg)` : `rotateY(${a}deg) rotateZ(90deg)`;
                plan(s.contenu, CARTE, h, 'tranche-cartes', null, (u) => `translate3d(${(cx + dx) * u}px,${(cy + dy) * u}px,${h / 2 * u}px) ${tour}`);
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
                px: s.cases[(e * 4 + k) % 9].cx, py: s.cases[(e * 4 + k) % 9].cy,
                pz: s.cases[(e * 4 + k) % 9].h + (e * 4 + k >= 9 ? EPAISSEUR : 0) + 0.6,
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
                const dx = e.clientX - x0, t = performance.now();
                if (Math.abs(dx) > 3 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
                s.doigt += dx * 0.6;
                s.vitesse = (dx * 0.6) / Math.max(8, t - t0) * 16;
                x0 = e.clientX; t0 = t;
            });
            const lacher = () => { s.tenue = false; };
            el.addEventListener('pointerup', lacher);
            el.addEventListener('pointercancel', lacher);
        }
        new IntersectionObserver((es) => { s.visible = es[0].isIntersecting; }).observe(el);
        el.classList.add('prete');
        return s;
    }

    // Côté de la boîte au repos, et où elle se pose (à gauche du texte sur ordinateur, au-dessus sur téléphone)
    function repos(nom) {
        const w = window.innerWidth, h = window.innerHeight;
        if (etroit()) {
            const S = nom === 'fermeture' ? Math.min(0.54 * w, 0.24 * h, 230) : Math.min(0.62 * w, 0.3 * h, 300);
            return { S, x: 0, y: (nom === 'fermeture' ? 78 : 72) + S * 0.62 - h / 2 };
        }
        if (nom === 'heros') {
            // ordinateur : la boîte au centre, la promesse dessous
            const S = Math.min(360, 0.38 * h);
            return { S, x: 0, y: 80 + S * 0.62 - h / 2 };
        }
        const S = Math.min(420, 0.3 * w, 0.5 * h);
        return { S, x: -Math.min(1120, w - 32) / 4, y: 0 };
    }

    // Pose toute la scène pour t ∈ [0, 1] : 0 = boîte fermée, 1 = partie prête
    function poser(s, t, temps) {
        const w = window.innerWidth, h = window.innerHeight;
        const r = repos(s.el.dataset.scene);
        const u = r.S / BOITE;
        if (u !== s.u || !s.pose) {
            s.u = u; s.pose = true;
            s.planes.forEach((p) => {
                p.d.style.width = p.l * u + 'px';
                p.d.style.height = p.h * u + 'px';
                p.d.style.left = -p.l * u / 2 + 'px';
                p.d.style.top = -p.h * u / 2 + 'px';
                if (p.pose) p.d.style.transform = p.pose(u);
            });
            s.el.parentElement.style.setProperty('--S', r.S + 'px');
            s.el.style.perspective = Math.max(w, h) * 1.7 + 'px';
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
        let ay = mix(0, -28, debout) + (s.doigt + (s.tour || 0)) * debout + Math.sin(temps / 1.7) * 6 * balance;
        const ax = mix(etroit() ? 38 : 50, -14, debout) + Math.sin(temps / 2.3) * 2.5 * balance;
        const az = mix(-8, 0, debout) + s.doigt * (1 - debout) * 0.3;
        // arrivée : la boîte pivote doucement d'un huitième de tour
        if (s.el.dataset.scene === 'heros' && !calme) ay -= 45 * (1 - lisse(0, 1, temps / 1.4));
        const flotte = calme ? 0 : Math.sin(temps / 1.9) * 7 * debout;
        const ox = r.x * debout, oy = r.y * debout + (etroit() ? 6 : -10) * couche + flotte;
        s.el.style.perspectiveOrigin = `calc(50% + ${ox}px) calc(50% + ${oy}px)`;
        const zc = HAUT / 2 * debout * u;
        s.monde.style.transform = `translate(${ox}px,${oy}px) scale(${k}) rotateX(${ax}deg) rotateY(${ay}deg) rotateZ(${az}deg) translateZ(${-zc}px)`;
        s.dessus.style.setProperty('--reflet', 50 + ay * 1.2 + '%');

        // Couvercle : il se soulève, puis part vers le fond
        const leve = lisse(0.26, 0.36, t), part = lisse(0.32, 0.44, t);
        s.couvercle.style.transform = `translate3d(0,${-900 * part * u}px,${(200 * leve + 120 * part) * u}px) rotateX(${-25 * part}deg)`;
        s.couvercle.style.visibility = part >= 1 ? 'hidden' : '';

        // Plateau : il sort du fond et recule, puis (les cartes sorties) se pose au centre et se déplie : droite, puis bas
        const monte = lisse(0.36, 0.46, t), pose = lisse(0.52, 0.64, t);
        const u1 = lisse(0.54, 0.61, t), u2 = lisse(0.6, 0.67, t);
        const decal = Q / 2 * (1 - pose);
        const bz = mix(mix(HFOND - 12, 95, monte), 0.5, pose);
        const recule = -210 * monte * (1 - pose);
        s.plateau.style.transform = `translate3d(${decal * u}px,${(decal + recule) * u}px,${bz * u}px) rotateX(${-12 * monte * (1 - pose)}deg)`;
        s.colD.style.transform = `translateZ(${3 * (1 - u1) * u}px) rotateY(${-180 * (1 - u1)}deg)`;
        // boîte fermée : le plateau plié reste caché (sinon son dos passait parfois devant le couvercle)
        s.plateau.style.visibility = t < 0.3 ? 'hidden' : '';
        s.contenu.style.visibility = t < 0.27 ? 'hidden' : '';
        s.basG.style.transform = `translateZ(${1.2 * (1 - u2) * u}px) rotateX(${180 * (1 - u2)}deg)`;
        s.basD.style.transform = `translateZ(${1.2 * (1 - u2) * u}px) rotateX(${180 * (1 - u2)}deg)`;

        // Fond de boîte : vidé, il glisse sur le côté (il ne croise ni les piles ni le plateau)
        const sort = lisse(0.5, 0.58, t);
        s.fond.style.transform = `translate3d(${1000 * sort * u}px,0,0)`;
        s.fond.style.visibility = sort >= 1 ? 'hidden' : '';

        // Ombre : sous la boîte, puis sous le plateau
        const taille = mix(BOITE * 1.25, PLATEAU * 1.12, pose);
        s.ombre.style.transform = `translate3d(0,0,${-1 * u}px) scale(${taille / (PLATEAU * 1.12)})`;
        s.ombre.style.opacity = mix(0.9, 0.75, pose);

        // Cartes : du fond de la boîte à 4 piles posées hors du plateau, puis, le plateau déplié, sur leurs cases
        const monteC = lisse(0.42, 0.455, t), vaC = lisse(0.45, 0.52, t), poseC = lisse(0.49, 0.52, t);
        s.cartes.forEach((c) => {
            const debut = 0.68 + c.ordre * 0.0135, f = lisse(debut, debut + 0.07, t);
            const x = mix(mix(c.px, c.ex, vaC), c.x, f), y = mix(mix(c.py, c.ey, vaC), c.y, f);
            const z = mix(mix(mix(c.pz, 62, monteC), c.ez, poseC), 1.2, f) + Math.sin(Math.PI * f) * 35;
            const rz = mix(0, c.angle, f) + Math.sin(Math.PI * f) * 20;
            c.d.style.transform = `translate3d(${x * u}px,${y * u}px,${z * u}px) rotateZ(${rz}deg)`;
            // boîte fermée : inutile de dessiner les cartes
            c.d.style.visibility = t < 0.27 ? 'hidden' : '';
        });
    }

    const scenes = [...document.querySelectorAll('.scene3d')].map(creerScene);
    const sceneHeros = scenes.find((s) => s.el.dataset.scene === 'heros');
    const sceneFermeture = scenes.find((s) => s.el.dataset.scene === 'fermeture');
    const fermeture = document.getElementById('boite');
    const freins = document.getElementById('freins');
    const freinsLi = [...freins.querySelectorAll('.liste-freins li')];
    const freinsTitre = freins.querySelector('.titre');
    const freinsReponse = freins.querySelector('.reponse');
    const freinsPlateaux = freins.querySelector('.plateaux');
    const offre = fermeture.querySelector('.offre');

    const avance = (section) => {
        const r = section.getBoundingClientRect();
        return borne(-r.top / Math.max(1, r.height - window.innerHeight));
    };
    const debut = performance.now();
    let avant = 0;
    function animer(now) {
        const temps = (now - debut) / 1000;
        const dt = Math.min(0.1, (now - (avant || now)) / 1000);
        avant = now;
        // la partie avance à 8 images par seconde, fondu compris (9 s), s'arrête 2 s sur la fin, puis reprend
        if (partieVisible && !calme) {
            pause -= dt;
            if (pause <= 0) {
                positionVoulue += dt * 8;
                if (positionVoulue >= NB_IMAGES - 1) { positionVoulue = 0; pause = 2; imageVoulue = NB_IMAGES - 1; }
                else imageVoulue = Math.floor(positionVoulue);
                dessiner();
            }
        }
        scenes.forEach((s) => {
            if (s.visible === false) return;
            // la boîte se penche au doigt (au plus 35°, son dos ne se voit pas) et revient d'elle-même
            if (!s.tenue) { s.doigt *= Math.exp(-dt * 3); s.vitesse = 0; }
            s.doigt = borne(s.doigt, -35, 35);
            poser(s, s.t, temps);
        });
        if (!calme) requestAnimationFrame(animer);
    }

    // ======================= Partie en images (rendue avec Remotion) =======================
    const NB_IMAGES = 72;
    const taille = (window.innerWidth * (window.devicePixelRatio || 1) > 900 && window.innerWidth > 700) ? 1100 : 720;
    const images = new Array(NB_IMAGES);
    let imageVoulue = 0, imageAffichee = -1, positionVoulue = 0, pause = 0.6, partieVisible = false;
    // Fondu entre deux images voisines : gardé par Hugo le 10/11/2026 (/#net pour le comparer sans)
    const FONDU = location.hash !== '#net';
    canvas.width = canvas.height = taille;
    // Images décodées à l'avance (createImageBitmap) : sur téléphone, décoder un WebP au moment de le
    // dessiner, pendant le défilement, peut faire sauter des images (10/11/2026)
    const decodees = new Array(NB_IMAGES);
    function dessiner() {
        for (let k = imageVoulue; k >= 0; k--) {
            const im = decodees[k] || images[k];
            if (im && (decodees[k] || (im.complete && im.naturalWidth))) {
                if (k !== imageAffichee) {
                    ctx.drawImage(im, 0, 0, taille, taille);
                    imageAffichee = k;
                    canvas.parentElement.classList.add('pret');
                }
                if (FONDU && k === imageVoulue) {
                    const suivante = decodees[k + 1];
                    const part = positionVoulue - k;
                    if (suivante && part > 0.02) {
                        ctx.globalAlpha = part;
                        ctx.drawImage(suivante, 0, 0, taille, taille);
                        ctx.globalAlpha = 1;
                    }
                    imageAffichee = -2; // le mélange change à chaque mouvement : toujours redessiner
                }
                return;
            }
        }
    }
    function charger(k) {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => {
            const pret = () => { if (Math.abs(k - imageVoulue) < 3 || imageAffichee < 0) dessiner(); };
            if (window.createImageBitmap) {
                createImageBitmap(im).then((b) => { decodees[k] = b; pret(); }, pret);
            } else pret();
        };
        im.src = `/static/images/background/vitrine/partie/p${taille}-${String(k).padStart(2, '0')}.webp`;
        images[k] = im;
    }
    const ioFilm = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        ioFilm.disconnect();
        for (let k = 0; k < NB_IMAGES; k += 6) charger(k);
        for (let k = 0; k < NB_IMAGES; k++) if (!images[k]) charger(k);
    }, { rootMargin: '800px 0px' });
    ioFilm.observe(film);
    new IntersectionObserver((es) => { partieVisible = es[0].isIntersecting; }, { threshold: 0.3 }).observe(canvas);

    // ======================= Progression des éléments [data-p] =======================
    // 0 quand le centre de l'élément entre par le bas de l'écran, 1 quand il atteint le milieu.
    const suivis = new Set();
    function progressions(h) {
        suivis.forEach((el) => {
            const r = el.getBoundingClientRect();
            const p = el.dataset.p === 'traverse' ? borne((h - r.top) / (h + r.height))
                : borne((h * 0.95 - (r.top + r.height / 2)) / (h * 0.42));
            if (el._p === undefined || Math.abs(el._p - p) > 0.002) {
                el._p = p;
                el.style.setProperty('--p', p.toFixed(3));
            }
        });
    }
    const ioP = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) suivis.add(e.target); else suivis.delete(e.target); });
        if (!calme) progressions(window.innerHeight);
    }, { rootMargin: '10% 0px' });
    document.querySelectorAll('[data-p]').forEach((el) => ioP.observe(el));

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
            let col = pc.col, rang = pc.rang, saut = 0;
            COUPS.forEach(([c0, r0, c1, r1], k) => {
                if (col === c0 && rang === r0) {
                    const f = lisse(0.6 + k * 0.07, 0.66 + k * 0.07, pe);
                    col = mix(c0, c1, f); rang = mix(r0, r1, f); saut = Math.max(saut, Math.sin(Math.PI * f));
                    if (f >= 1) { col = c1; rang = r1; }
                }
            });
            const arrive = lisse(0.04 + pc.i * 0.014, 0.12 + pc.i * 0.014, pe);
            // les cartes arrivent de leur côté du plateau (Blancs en bas, Noirs en haut)
            const dy = (1 - arrive) * (pc.noir ? -260 : 260);
            pc.im.style.left = `${col * 12.5 + 0.75}%`;
            pc.im.style.top = `${(7 - rang) * 12.5 + 0.75}%`;
            pc.im.style.opacity = arrive;
            pc.im.style.transform = `translateY(${dy}%) rotate(${(pc.noir ? 180 : 0) + (1 - arrive) * (pc.noir ? -40 : 40)}deg) scale(${1 + saut * 0.25})`;
            pc.im.style.zIndex = saut > 0 ? 2 : 1;
        });
    }

    // ======================= Défilement =======================
    let attente = false;
    function maj() {
        attente = false;
        const y = window.scrollY, h = window.innerHeight;
        nav.classList.toggle('plein', y > 40);
        // la barre « Jouer » du bas se cache pendant l'animation de la boîte (elle cacherait les légendes et l'offre)
        collante.classList.toggle('visible', y > h * 0.8 && y < fermeture.offsetTop - h * 0.3);
        if (!calme && y < h * 1.2) fond.style.transform = `translateY(${y * 0.25}px) scale(${1 + y / 5000})`;
        if (sceneHeros) sceneHeros.t = 0;

        if (echiquier) poserEchecs(calme ? 0.6 : avance(echecs));

        // Fin de page : la partie est en place, puis tout rentre dans la boîte, qui se referme
        const pf = calme ? 1 : avance(fermeture);
        if (sceneFermeture) sceneFermeture.t = 1 - lisse(0.04, 0.74, pf);
        const montre = lisse(0.72, 0.86, pf);
        offre.style.opacity = montre;
        offre.style.transform = `translateY(${(1 - montre) * 30}px)`;
        offre.classList.toggle('visible', montre > 0.5);

        // Freins : ils arrivent un à un (0 → 0,36), sont barrés un à un (0,4 → 0,64), s'en vont ensemble
        // (0,68 → 0,8), puis la promesse prend la place (0,78 → 0,92)
        if (!calme) {
            const pr = avance(freins);
            const part = lisse(0.68, 0.8, pr);
            freinsLi.forEach((li, i) => {
                li.style.setProperty('--a', lisse(0.02 + i * 0.07, 0.09 + i * 0.07, pr).toFixed(3));
                li.style.setProperty('--s', lisse(0.4 + i * 0.05, 0.46 + i * 0.05, pr).toFixed(3));
                li.style.setProperty('--x', part.toFixed(3));
            });
            freinsTitre.style.opacity = 1 - part;
            // derrière : les flèches couvrent l'échiquier pendant qu'on lit les freins, puis le plateau de MATATAK arrive
            freinsPlateaux.style.setProperty('--fl', lisse(0.04, 0.62, pr).toFixed(3));
            freinsPlateaux.style.setProperty('--m', lisse(0.66, 0.84, pr).toFixed(3));
            freinsReponse.style.setProperty('--r', lisse(0.78, 0.92, pr).toFixed(3));
        }

        if (!calme) progressions(h);
        if (calme) { animer(performance.now()); if (imageAffichee < 0) dessiner(); }
    }
    window.addEventListener('scroll', () => {
        if (!attente) { attente = true; requestAnimationFrame(maj); }
    }, { passive: true });
    window.addEventListener('resize', () => { scenes.forEach((s) => { s.pose = false; }); maj(); }, { passive: true });
    maj();
    requestAnimationFrame(animer);

    // ======================= Carte vedette =======================
    const vedette = document.querySelector('.vedette .carte-rv');
    if (vedette && !calme) {
        const pencher = (x, y) => { vedette.style.setProperty('--tx', x.toFixed(1)); vedette.style.setProperty('--ty', y.toFixed(1)); };
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

    // ======================= Apparition des blocs =======================
    const tout = document.querySelectorAll('.mt-apparait');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('vu'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    tout.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 80 + 'ms'; io.observe(el); });
})();
