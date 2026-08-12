import { _ } from './i18n';

export interface BannerButton {
    text: string;
    style?: 'primary' | 'secondary' | 'outline';
    onClick: () => void;
}

export interface BannerOptions {
    title: string;
    subtitle?: string;
    buttons?: BannerButton[];
    // Propriétés rétrocompatibles
    actionText?: string;
    onAction?: () => void;
    autoCloseMs?: number;
    badgeIcon?: string;
    onClose?: () => void;
}

export function showBannerOverlay(options: BannerOptions): HTMLElement {
    // Supprimer tout ancien bandeau existant
    const existing = document.querySelectorAll('.game-over-overlay');
    existing.forEach(el => el.remove());

    const cgWrap = document.querySelector('.cg-wrap');
    if (!cgWrap) return document.body;

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';

    // Rétrocompatibilité si un seul bouton actionText/onAction est passé
    const buttonsList: BannerButton[] = options.buttons ? [...options.buttons] : [];
    if (options.actionText && options.onAction && buttonsList.length === 0) {
        buttonsList.push({
            text: options.actionText,
            style: 'primary',
            onClick: options.onAction
        });
    }

    let buttonsHtml = '';
    if (buttonsList.length > 0) {
        buttonsHtml = `<div class="banner-buttons-row">` +
            buttonsList.map((btn, idx) => {
                const styleClass = btn.style || 'primary';
                return `<button class="banner-btn banner-btn-${styleClass}" data-btn-idx="${idx}">${btn.text}</button>`;
            }).join('') +
            `</div>`;
    }

    const badgeHtml = options.badgeIcon ? `<div class="banner-badge">${options.badgeIcon}</div>` : '';
    const subtitleHtml = options.subtitle ? `<h2>${options.subtitle}</h2>` : '';
    const dismissTextHtml = `<div class="banner-dismiss-hint">${_("Cliquez n'importe où pour revoir le plateau")} ✕</div>`;

    overlay.innerHTML = `
      <div class="content" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 0 10px; box-sizing: border-box;">
        ${badgeHtml}
        <h1>${options.title}</h1>
        ${subtitleHtml}
        ${buttonsHtml}
        ${dismissTextHtml}
      </div>
    `;

    // Gestion du clic sur les boutons spécifiques
    const buttonEls = overlay.querySelectorAll('.banner-btn');
    buttonEls.forEach(btnEl => {
        btnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const idxStr = (btnEl as HTMLElement).dataset.btnIdx;
            if (idxStr !== undefined) {
                const idx = parseInt(idxStr, 10);
                overlay.remove();
                if (buttonsList[idx] && buttonsList[idx].onClick) {
                    buttonsList[idx].onClick();
                }
            }
        });
    });

    // Clic en dehors des boutons (sur le fond du bandeau) : fermer sans déclencher l'action principale
    overlay.addEventListener('click', (e) => {
        overlay.remove();
        if (options.onClose) options.onClose();
    });

    cgWrap.appendChild(overlay);

    if (options.autoCloseMs) {
        setTimeout(() => {
            if (document.body.contains(overlay)) {
                overlay.remove();
            }
        }, options.autoCloseMs);
    }

    return overlay;
}
