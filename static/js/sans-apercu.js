// Pas d'aperçu fantôme quand on appuie sur une image et qu'on la déplace (Hugo, 18/11/2026 : « comme quand on
// sélectionnait du texte sans le vouloir, c'est pas pro »). Le CSS (-webkit-user-drag, matatak-ui.css) suffit à
// Chrome et Safari ; Firefox l'ignore, d'où ce script. Aucune page n'utilise le glisser-déposer natif des images
// (le plateau et l'éditeur passent par les pointeurs).
document.addEventListener('dragstart', (e) => {
    if (e.target instanceof HTMLImageElement) e.preventDefault();
});
