import { h, VNode } from "snabbdom";
import { PyChessModel } from "./types";
import { patch } from "./document";

export interface CampaignLevel {
    level: number;
    puzzle_id: string;
    fen: string;
    moves: string;
    eval: string;
    type: string;
    variant: string;
    intro?: {
        piece: string;
        piece_name: string;
        title: string;
        text: string;
    };
}

export class CampaignView {
    variant: string;
    levels: CampaignLevel[] = [];
    solvedLevels: number[] = [];

    constructor(variant: string) {
        this.variant = variant;
        const key = `matatak_campaign_solved_${variant}`;
        try {
            this.solvedLevels = JSON.parse(localStorage.getItem(key) || "[]");
        } catch {
            this.solvedLevels = [];
        }
    }

    render(levels: CampaignLevel[]): VNode {
        this.levels = levels;
        const total = levels.length || 200;
        const autre = this.variant === "matatakmini" ? "matatak" : "matatakmini";
        const nomVariante = (v: string) => v === "matatakmini" ? "Matatak Mini" : "Matatak";

        // Niveau recommandé : le plus petit non résolu
        let suivant = total + 1;
        for (let i = 1; i <= total; i++) {
            if (!this.solvedLevels.includes(i)) { suivant = i; break; }
        }
        const resolus = this.solvedLevels.filter(n => n >= 1 && n <= total).length;
        const fini = suivant > total;

        // Chapitres de 20 niveaux : seul celui du niveau recommandé est ouvert
        const TAILLE = 20;
        const chapitres = Array.from({ length: Math.ceil(total / TAILLE) }, (_, c) => {
            const debut = c * TAILLE + 1;
            const fin = Math.min(total, debut + TAILLE - 1);
            const niveaux = Array.from({ length: fin - debut + 1 }, (_, i) => debut + i);
            const faits = niveaux.filter(n => this.solvedLevels.includes(n)).length;
            const ouvert = fini ? c === 0 : suivant >= debut && suivant <= fin;
            return h("details.chapitre", { attrs: { open: ouvert } }, [
                h("summary", [
                    h("span.chapitre-nom", `Niveaux ${debut} à ${fin}`),
                    h("span.chapitre-compte", { class: { complet: faits === niveaux.length } }, `${faits} / ${niveaux.length}`),
                ]),
                h("div.niveaux", niveaux.map(n => {
                    const fait = this.solvedLevels.includes(n);
                    const actuel = n === suivant;
                    return h("a.niveau", {
                        class: { fait, actuel },
                        attrs: {
                            href: `/puzzle/${this.variant}/level/${n}`,
                            "aria-label": `Niveau ${n}${fait ? ", réussi" : actuel ? ", à jouer" : ""}`,
                        },
                    }, String(n));
                })),
            ]);
        });

        return h("div.campagne", [
            h("h1", "Campagne de puzzles"),
            h("p.campagne-sous-titre", `${nomVariante(this.variant)} · ${total} niveaux, du plus simple au plus rusé.`),
            h("div.campagne-progression", [
                h("div.barre", { attrs: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(resolus) } },
                    h("i", { style: { width: `${resolus / total * 100}%` } })),
                h("span", resolus === 0 ? "Aucun niveau réussi pour l'instant" : `${resolus} niveau${resolus > 1 ? "x" : ""} réussi${resolus > 1 ? "s" : ""} sur ${total}`),
            ]),
            fini
                ? h("p.campagne-fini", "Bravo, vous avez réussi tous les niveaux !")
                : h("a.mt-btn.mt-btn-or.campagne-continuer", { attrs: { href: `/puzzle/${this.variant}/level/${suivant}` } },
                    resolus === 0 ? "Commencer" : `Continuer · Niveau ${suivant}`),
            h("div.chapitres", chapitres),
            h("a.campagne-autre", { attrs: { href: `/puzzle/campaign/${autre}` } }, `Campagne ${nomVariante(autre)} →`),
        ]);
    }
}

export function campaignView(model: PyChessModel): VNode {
    const variant = model.variant || "matatakmini";
    const view = new CampaignView(variant);

    // Initial state with empty levels
    let levels: CampaignLevel[] = [];

    // Trigger async fetch of campaign levels from API
    fetch(`/api/campaign/${variant}`)
        .then(res => res.json())
        .then(data => {
            levels = data;
            const container = document.getElementById("campaign-container");
            if (container) {
                patch(container, view.render(levels));
            }
        })
        .catch(err => console.error("Error fetching campaign levels:", err));

    return h("div#campaign-container", [view.render(levels)]);
}

