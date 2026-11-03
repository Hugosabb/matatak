// MATATAK ! (échec) : la carte du Roi fait une petite secousse quand l'échec arrive (Hugo, 03/11/2026).
// Chessground marque la case du Roi par `square.check` ; on secoue la carte posée sur la même case
// (même position à l'écran). Le liseré qui pulse est dans static/chessground.css.
(function () {
    if (!('MutationObserver' in window)) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var derniere = new WeakMap(); // plateau -> position de la dernière case en échec secouée

    function secouer(caseEchec) {
        var plateau = caseEchec.closest('cg-board');
        if (!plateau) return;
        var position = caseEchec.style.transform;
        if (derniere.get(plateau) === position) return; // même échec, rien de neuf
        derniere.set(plateau, position);
        var pieces = plateau.querySelectorAll('piece');
        for (var i = 0; i < pieces.length; i++) {
            var piece = pieces[i];
            if (piece.style.transform === position && !piece.classList.contains('ghost')) {
                piece.classList.remove('secoue');
                void piece.offsetWidth; // relance l'animation si elle tournait encore
                piece.classList.add('secoue');
                piece.addEventListener('animationend', function fin(e) {
                    e.currentTarget.classList.remove('secoue');
                    e.currentTarget.removeEventListener('animationend', fin);
                });
                return;
            }
        }
    }

    function oublier(plateau) {
        if (plateau && !plateau.querySelector('square.check')) derniere.delete(plateau);
    }

    new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type === 'attributes') {
                var el = m.target;
                if (el.tagName === 'SQUARE') {
                    if (el.classList.contains('check')) secouer(el);
                    else oublier(el.closest('cg-board'));
                }
            } else {
                for (var j = 0; j < m.addedNodes.length; j++) {
                    var n = m.addedNodes[j];
                    if (n.nodeType !== 1) continue;
                    if (n.tagName === 'SQUARE' && n.classList.contains('check')) secouer(n);
                    else if (n.querySelectorAll) n.querySelectorAll('square.check').forEach(secouer);
                }
                if (m.removedNodes.length && m.target.closest) oublier(m.target.closest('cg-board'));
            }
        }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
})();
