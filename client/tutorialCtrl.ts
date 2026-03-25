import { h, VNode } from 'snabbdom';
import { _ } from './i18n';
import { PuzzleController } from './puzzleCtrl';
import { PyChessModel } from "./types";
import { patch } from './document';

export class TutorialController extends PuzzleController {
    instruction: string;
    successMsg: string;
    title: string;
    tutorialId: number;

    constructor(el: HTMLElement, model: PyChessModel) {
        super(el, model);
        const data = JSON.parse(model.puzzle);
        this.instruction = data.instruction;
        this.successMsg = data.success_msg;
        this.title = data.title || '';
        this.tutorialId = parseInt(this._id);
        
        // Hide puzzle ratings and auto-next
        const userInfosEl = document.querySelector('.puzzle-user') as HTMLElement;
        if (userInfosEl) userInfosEl.style.display = 'none';
        const infoEl = document.querySelector('.puzzle-info') as HTMLElement;
        if (infoEl) infoEl.style.display = 'none';

        // Override the hint and solution buttons
        const viewHintEl = document.querySelector('.hint') as HTMLElement;
        if (viewHintEl) patch(viewHintEl, h('div'));

        const viewSolutionEl = document.querySelector('.solution') as HTMLElement;
        if (viewSolutionEl) patch(viewSolutionEl, h('div'));

        this.renderInfos();
        this.yourTurn();
    }

    renderInfos() {
        // this.instruction is undefined when called from super() — skip early calls
        if (!this.instruction) return;
        const infosEl = document.querySelector('.infos') as HTMLElement;
        if (!infosEl) return;
        const totalSteps = 10;
        const id = this.tutorialId || parseInt(this._id);
        const progress = Math.round((id / totalSteps) * 100);
        patch(infosEl, h('div.infos.tutorial-info', [
            this.title ? h('h2.tutorial-title', this.title) : '',
            h('p.tutorial-instruction', this.instruction),
            h('div.tutorial-progress', [
                h('div.tutorial-progress-bar', { style: { width: `${progress}%` } }),
            ]),
            h('span.tutorial-step-label', `Étape ${id} / ${totalSteps}`),
        ]));
    }

    yourTurn() {
        if (!this.playerEl || !this.variant) return;

        const turnColor = this.fullfen.split(" ")[1];
        const pieceColor = (turnColor == 'w') ? 'white' : 'black';
        const kingRole = this.variant.kingRoles[0];
        
        this.playerEl = patch(this.playerEl,
            h(`div.player.${this.variant.pieceFamily}`, [
                h(`piece.${pieceColor}.no-square.${kingRole}.ally`),
                h('div.instruction', [
                    h('strong', _('À toi de jouer !')),
                ]),
            ])
        );
    }

    notTheMove(san: string) {
        this.failed = true;
        this.playerEl = patch(this.playerEl,
            h('div.player', [
                h('div.icon', '✗'),
                h('div.instruction', [
                    h('san', [san, h('span.fail', '?')]),
                    h('strong', _("Oups, ce n'est pas ce qui est demandé.")),
                    h('em', _('Essaie encore.')),
                ]),
            ])
        );
        const feedbackEl = document.querySelector('.feedback') as HTMLInputElement;
        if (feedbackEl) {
            feedbackEl.classList.toggle('good', false);
            feedbackEl.classList.toggle('fail', true);
        }
    }

    bestMove() {
        // Not used heavily in single-move tutorials, but let's override it just in case
        this.playerEl = patch(this.playerEl,
            h('div.player', [
                h('div.icon', '✓'),
                h('div.instruction', [
                    h('strong', _("Bon coup !")),
                    h('em', _('Continue...')),
                ]),
            ])
        );
    }

    puzzleComplete(success: boolean) {
        this.completed = true;
        const totalSteps = 10;
        const progress = Math.round((this.tutorialId / totalSteps) * 100);

        // Replace the top instruction zone with success message + next button, keeping progress bar
        const infoEl = document.querySelector('.tutorial-info') as HTMLElement;
        if (infoEl) {
            patch(infoEl, h('div.infos.tutorial-info.tutorial-success', [
                h('p.tutorial-success-msg', this.successMsg),
                h('a.button.primary',
                    { on: { click: () => this.nextTutorial() } },
                    this.tutorialId < 10 ? _('Étape Suivante ➔') : _('Terminer le tutoriel')
                ),
                h('div.tutorial-progress', [
                    h('div.tutorial-progress-bar', { style: { width: `${progress}%` } }),
                ]),
                h('span.tutorial-step-label', `Étape ${this.tutorialId} / ${totalSteps}`),
            ]));
        }

        // Clear the old feedback zone
        const feedbackEl = document.querySelector('.feedback') as HTMLElement;
        if (feedbackEl) patch(feedbackEl, h('div.feedback'));

        const engineEl = document.querySelector('.engine') as HTMLElement;
        if (engineEl) engineEl.style.display = 'flex';
    }

    nextTutorial() {
        if (this.tutorialId < 10) {
            window.location.assign('/tutorial/' + (this.tutorialId + 1));
        } else {
            window.location.assign('/'); // End of tutorial, back to lobby
        }
    }
}
