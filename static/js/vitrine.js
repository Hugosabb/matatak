// Vitrine (page de vente) : tout ce qui vit au défilement.
// - la boîte en 3D : elle arrive en tournant, flotte, se tourne au doigt (balayage horizontal) et au défilement ;
// - [data-p] : progression 0 → 1 posée en variable CSS --p quand l'élément traverse l'écran (freins barrés,
//   éventails des Saisons, cartes qui se retournent, Rois qui montent) ;
// - la partie en 72 images de la section collante.
(function () {
    const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = document.getElementById('nav');
    const collante = document.getElementById('collante');
    const fond = document.getElementById('fond');
    const heros = document.getElementById('heros');
    const film = document.getElementById('film') || document.getElementById('comment');
    const scene = document.getElementById('scene');
    const ctx = scene.getContext('2d');
    const borne = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const lisse = (a, b, x) => { const t = borne((x - a) / (b - a)); return t * t * (3 - 2 * t); };

    // ---------- Partie en images (rendue avec Remotion) : le défilement fait avancer la partie ----------
    const NB_IMAGES = 72;
    const taille = (window.innerWidth * (window.devicePixelRatio || 1) > 900 && window.innerWidth > 700) ? 1100 : 720;
    const images = new Array(NB_IMAGES);
    let imageVoulue = 0, imageAffichee = -1, positionVoulue = 0;
    // Fondu entre deux images voisines : gardé par Hugo le 10/11/2026 (/#net pour le comparer sans)
    const FONDU = location.hash !== '#net';
    scene.width = scene.height = taille;
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
                    scene.parentElement.classList.add('pret');
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
    const etapes = [...film.querySelectorAll('.etape')];
    const progression = film.querySelector('.progression');
    const remplissage = film.querySelector('.progression b');

    // ---------- Progression des éléments [data-p] ----------
    // 0 quand le centre de l'élément entre par le bas de l'écran, 1 quand il atteint le milieu.
    const suivis = new Set();
    const ioP = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) suivis.add(e.target); else suivis.delete(e.target); });
        if (!calme) progressions(window.innerHeight);
    }, { rootMargin: '10% 0px' });
    document.querySelectorAll('[data-p]').forEach((el) => ioP.observe(el));
    function progressions(h) {
        suivis.forEach((el) => {
            const r = el.getBoundingClientRect();
            const centre = r.top + r.height / 2;
            const p = borne((h * 0.95 - centre) / (h * 0.42));
            const ancien = el._p;
            if (ancien === undefined || Math.abs(ancien - p) > 0.002) {
                el._p = p;
                el.style.setProperty('--p', p.toFixed(3));
            }
        });
    }

    // ---------- Boîtes en 3D ----------
    // Angle = base (défilement) + balancement + inclinaison du téléphone + ce que le doigt a tourné.
    let incliX = 0, incliY = 0;
    const boites = [...document.querySelectorAll('.scene-boite')].map((sc) => {
        const el = sc.querySelector('.boite3d');
        const b = { sc, el, doigt: 0, vitesse: 0, tenue: false, visible: true, base: { rx: -14, ry: -28 } };
        if (!calme) {
            let x0 = 0, t0 = 0;
            el.addEventListener('pointerdown', (e) => {
                b.tenue = true; b.vitesse = 0; x0 = e.clientX; t0 = performance.now();
                el.classList.add('tenue'); sc.classList.add('touchee');
            });
            el.addEventListener('pointermove', (e) => {
                if (!b.tenue) return;
                const dx = e.clientX - x0, t = performance.now();
                if (Math.abs(dx) > 3 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
                b.doigt += dx * 0.6;
                b.vitesse = (dx * 0.6) / Math.max(8, t - t0) * 16;
                x0 = e.clientX; t0 = t;
            });
            const lacher = () => { b.tenue = false; el.classList.remove('tenue'); };
            el.addEventListener('pointerup', lacher);
            el.addEventListener('pointercancel', lacher);
        }
        new IntersectionObserver((es) => { b.visible = es[0].isIntersecting; }).observe(sc);
        return b;
    });
    const [boiteHeros, boiteProduit] = boites;
    // Inclinaison du téléphone (Android : sans autorisation ; l'iPhone en demande une, on s'en passe)
    if (!calme) {
        window.addEventListener('deviceorientation', (e) => {
            if (e.gamma == null) return;
            incliY = borne(e.gamma, -30, 30) * 0.35;
            incliX = borne((e.beta || 45) - 45, -30, 30) * -0.15;
        }, { passive: true });
    }
    const debut = performance.now();
    function animerBoites(t) {
        const temps = (t - debut) / 1000;
        boites.forEach((b) => {
            if (!b.visible) return;
            if (!b.tenue) {
                b.doigt += b.vitesse;
                b.vitesse *= 0.94;
                if (Math.abs(b.vitesse) < 0.01) b.vitesse = 0;
            }
            let ry = b.base.ry + b.doigt + incliY, rx = b.base.rx + incliX;
            if (!calme) {
                ry += Math.sin(temps / 1.7) * 6;
                rx += Math.sin(temps / 2.3) * 2.5;
                // Arrivée : la boîte tourne sur elle-même au chargement de la page
                if (b === boiteHeros) ry -= 200 * (1 - lisse(0, 1, temps / 1.6));
            }
            b.el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
            b.el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
        });
        requestAnimationFrame(animerBoites);
    }

    // ---------- Défilement ----------
    let attente = false;
    function maj() {
        attente = false;
        const y = window.scrollY, h = window.innerHeight;
        nav.classList.toggle('plein', y > 40);
        collante.classList.toggle('visible', y > h * 0.8);
        if (!calme && y < h * 1.2) fond.style.transform = `translateY(${y * 0.25}px) scale(${1 + y / 5000})`;

        // Boîte du héros : elle pivote en partant
        const ph = borne(y / Math.max(1, heros.offsetHeight));
        boiteHeros.base = { ry: -28 + ph * 50, rx: -14 - ph * 16 };
        // Boîte du produit : face au début, puis elle se retourne pour montrer son dos, comme en magasin
        if (boiteProduit) {
            const r = boiteProduit.sc.getBoundingClientRect();
            const pt = borne((h - r.top) / (h + r.height));
            boiteProduit.base = { ry: -24 + 180 * lisse(0.3, 0.72, pt), rx: -10 - 8 * lisse(0, 1, pt) };
        }

        // Section collante de la partie
        const r = film.getBoundingClientRect();
        const p = borne(-r.top / (r.height - h));
        positionVoulue = p * (NB_IMAGES - 1);
        imageVoulue = FONDU ? Math.floor(positionVoulue) : Math.round(positionVoulue);
        dessiner();
        const i = Math.min(etapes.length - 1, Math.floor(p * etapes.length));
        etapes.forEach((e, k) => e.classList.toggle('active', k === i));
        // Une seule barre qui se remplit, et une flèche vers le bas tant qu'il reste à voir : trois points
        // côte à côte faisaient croire à un carrousel à balayer de côté (Hugo, 03/11/2026)
        if (remplissage) remplissage.style.transform = `scaleX(${p})`;
        if (progression) progression.classList.toggle('fini', p > 0.98);

        if (!calme) progressions(h);
    }
    window.addEventListener('scroll', () => {
        if (!attente) { attente = true; requestAnimationFrame(maj); }
    }, { passive: true });
    window.addEventListener('resize', maj, { passive: true });
    maj();
    requestAnimationFrame(() => { maj(); requestAnimationFrame(animerBoites); });

    // ---------- Apparition des blocs ----------
    const tout = document.querySelectorAll('.mt-apparait');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('vu'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    tout.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 80 + 'ms'; io.observe(el); });
})();
