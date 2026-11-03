// Bouton qui se répète quand on garde le doigt (ou la souris) appuyé : flèches ‹ › des coups.
// Un toucher = un coup ; appui long = les coups défilent, de plus en plus vite (Hugo, 02/11/2026).
// Renvoie les écouteurs Snabbdom à mettre dans `on`.

const PREMIERE_ATTENTE = 380;   // ms avant que la répétition commence
const ATTENTE_DEPART = 260;     // ms entre deux coups au début
const ATTENTE_MIN = 45;         // ms entre deux coups au plus vite
const ACCELERATION = 0.8;       // chaque pas raccourcit l'attente

export function appuiRepete(action: () => void) {
    let minuteur: ReturnType<typeof setTimeout> | undefined;

    const arreter = () => {
        if (minuteur !== undefined) clearTimeout(minuteur);
        minuteur = undefined;
    };
    const repeter = (attente: number) => {
        minuteur = setTimeout(() => {
            action();
            repeter(Math.max(ATTENTE_MIN, attente * ACCELERATION));
        }, attente);
    };

    return {
        pointerdown: (e: PointerEvent) => {
            if (e.button !== 0) return;
            arreter();
            action();
            minuteur = setTimeout(() => repeter(ATTENTE_DEPART), PREMIERE_ATTENTE);
        },
        pointerup: arreter,
        pointerleave: arreter,
        pointercancel: arreter,
        // Appui long sur téléphone : pas de menu du navigateur
        contextmenu: (e: Event) => e.preventDefault(),
        // Le clic qui suit un appui est déjà compté ; seul le clavier (Entrée, Espace : detail = 0) passe par ici
        click: (e: MouseEvent) => { if (e.detail === 0) action(); },
    };
}
