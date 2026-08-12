import { h, VNode } from "snabbdom";
import { PyChessModel } from "./types";
import { _ } from "./i18n";
import { VARIANTS } from "./variants";

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
        const variantObj = VARIANTS[this.variant] || VARIANTS["matatak"];

        // Trouver le niveau recommandé (le plus petit non résolu, ou 1)
        let recommendedLevel = 1;
        for (let i = 1; i <= 200; i++) {
            if (!this.solvedLevels.includes(i)) {
                recommendedLevel = i;
                break;
            }
        }

        const completedCount = this.solvedLevels.length;

        return h("div.campaign", [
            h("div.campaign-header", { style: { textAlign: "center", marginBottom: "20px" } }, [
                h("h1", [
                    h("span.icon", { attrs: { "data-icon": variantObj.icon() } }),
                    ` ${_("Mode Aventure")} - ${variantObj.displayName()}`,
                ]),
                h("p.description", { style: { fontSize: "1.1em", opacity: "0.9" } }, [
                    _("Apprenez la tactique à votre rythme."),
                ]),
                h("div.campaign-progress", { style: { marginTop: "10px" } }, [
                    h("span.badge", { style: { background: "#28a745", color: "#fff", padding: "5px 12px", borderRadius: "15px", fontWeight: "bold" } }, [
                        `✅ ${completedCount} / 200 ${_("niveaux réussis")}`
                    ]),
                    recommendedLevel <= 200
                        ? h("a.button.hero-btn", {
                              attrs: { href: `/puzzle/${this.variant}/level/${recommendedLevel}` },
                              style: { marginLeft: "15px", display: "inline-block", background: "#007bff", color: "#fff", padding: "6px 16px", borderRadius: "6px", textDecoration: "none" }
                          }, [
                              `▶ ${_("Continuer : Niveau")} ${recommendedLevel}`
                          ])
                        : null
                ])
            ]),

            // Grille des 200 niveaux sous forme de radio-group / boutons
            h("div.campaign-grid-container", { style: { background: "rgba(0, 0, 0, 0.15)", padding: "15px", borderRadius: "8px" } }, [
                h("h3", { style: { marginBottom: "15px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "8px" } }, [
                    _("Sélectionnez n'importe quel niveau :")
                ]),
                h("div.campaign-grid", {
                    style: {
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(65px, 1fr))",
                        gap: "8px",
                        maxHeight: "550px",
                        overflowY: "auto",
                        paddingRight: "5px"
                    }
                }, Array.from({ length: 200 }, (_, i) => i + 1).map(lvl => {
                    const isSolved = this.solvedLevels.includes(lvl);
                    const isRecommended = lvl === recommendedLevel;

                    let bg = "rgba(255, 255, 255, 0.08)";
                    let border = "1px solid rgba(255, 255, 255, 0.15)";
                    let color = "#ddd";
                    let badge = "";

                    if (isSolved) {
                        bg = "#28a745";
                        border = "1px solid #218838";
                        color = "#fff";
                        badge = "✓";
                    } else if (isRecommended) {
                        bg = "#007bff";
                        border = "2px solid #6610f2";
                        color = "#fff";
                        badge = "★";
                    }

                    return h("a.level-card", {
                        attrs: {
                            href: `/puzzle/${this.variant}/level/${lvl}`,
                            title: `Niveau ${lvl} ${isSolved ? "(Réussi)" : ""}`
                        },
                        style: {
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "8px 4px",
                            background: bg,
                            border: border,
                            borderRadius: "6px",
                            color: color,
                            textDecoration: "none",
                            fontWeight: "bold",
                            fontSize: "14px",
                            transition: "transform 0.1s ease, filter 0.1s ease",
                            boxShadow: isRecommended ? "0 0 8px rgba(0,123,255,0.6)" : "none"
                        }
                    }, [
                        h("span.lvl-num", `${lvl}`),
                        badge ? h("span.badge-icon", { style: { fontSize: "10px", marginTop: "2px" } }, badge) : null
                    ]);
                }))
            ])
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

    return h("div#campaign-container.campaign", [view.render(levels)]);
}

