// Vitrine : animations au défilement (fond du héros, section collante, Saisons en éventail).
(function () {
    const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = document.getElementById('nav');
    const collante = document.getElementById('collante');
    const fond = document.getElementById('fond');
    const film = document.getElementById('film');
    const scene = document.getElementById('scene');
    const ctx = scene.getContext('2d');

    // Partie en images (rendue avec Remotion) : le défilement fait avancer la partie.
    const NB_IMAGES = 72;
    const taille = (window.innerWidth * (window.devicePixelRatio || 1) > 900 && window.innerWidth > 700) ? 1100 : 720;
    const images = new Array(NB_IMAGES);
    let imageVoulue = 0, imageAffichee = -1;
    scene.width = scene.height = taille;
    function dessiner() {
        // l'image voulue, sinon la plus proche déjà chargée en arrière
        for (let k = imageVoulue; k >= 0; k--) {
            const im = images[k];
            if (im && im.complete && im.naturalWidth) {
                if (k !== imageAffichee) {
                    ctx.drawImage(im, 0, 0, taille, taille);
                    imageAffichee = k;
                    scene.parentElement.classList.add('pret');
                }
                return;
            }
        }
    }
    function charger(k) {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => { if (Math.abs(k - imageVoulue) < 3 || imageAffichee < 0) dessiner(); };
        im.src = `/static/images/background/vitrine/partie/p${taille}-${String(k).padStart(2, '0')}.webp`;
        images[k] = im;
    }
    // Chargement quand la section approche : d'abord une image sur 6 (aperçu rapide), puis le reste.
    const ioFilm = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        ioFilm.disconnect();
        for (let k = 0; k < NB_IMAGES; k += 6) charger(k);
        for (let k = 0; k < NB_IMAGES; k++) if (!images[k]) charger(k);
    }, { rootMargin: '800px 0px' });
    ioFilm.observe(film);
    const etapes = [...document.querySelectorAll('.etape')];
    const barres = [...document.querySelectorAll('.progression i')];

    let attente = false;
    function maj() {
        attente = false;
        const y = window.scrollY, h = window.innerHeight;
        nav.classList.toggle('plein', y > 40);
        collante.classList.toggle('visible', y > h * 0.8);
        if (!calme && y < h * 1.2) {
            fond.style.transform = `translateY(${y * 0.25}px) scale(${1 + y / 5000})`;
        }
        // Progression dans la section collante : de 0 à 1
        const r = film.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, -r.top / (r.height - h)));
        imageVoulue = Math.round(p * (NB_IMAGES - 1));
        dessiner();
        const i = Math.min(2, Math.floor(p * 3));
        etapes.forEach((e, k) => e.classList.toggle('active', k === i));
        barres.forEach((b, k) => b.classList.toggle('on', k <= i));
    }
    window.addEventListener('scroll', () => {
        if (!attente) { attente = true; requestAnimationFrame(maj); }
    }, { passive: true });
    window.addEventListener('resize', maj, { passive: true });
    maj();

    // Apparition des blocs
    const tout = document.querySelectorAll('.mt-apparait, .boite');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('vu'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    tout.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 80 + 'ms'; io.observe(el); });

    // Saisons : sans survol (téléphone) ou en colonne, la Saison au centre de l'écran s'ouvre en éventail.
    const saisons = [...document.querySelectorAll('#saisons-liste .saison')];
    const tactile = matchMedia('(hover: none), (max-width: 700px)');
    let ioSaisons = null;
    function brancherSaisons() {
        if (ioSaisons) ioSaisons.disconnect();
        saisons.forEach((s) => s.classList.remove('ouvert'));
        if (!tactile.matches) return;
        ioSaisons = new IntersectionObserver((es) => es.forEach((e) => {
            e.target.classList.toggle('ouvert', e.isIntersecting);
        }), { rootMargin: '-30% 0px -30% 0px' });
        saisons.forEach((s) => ioSaisons.observe(s));
    }
    tactile.addEventListener('change', brancherSaisons);
    brancherSaisons();
})();
