import { openPushConsequenceSelector } from "./push-consequence-selector-app.mjs";

/** Opens the Keeper consequence selector window and auto-opens the player push confirmation when ready. */
export class PushConsequencePromptHelper {
    static #openedSelectorMessages = new Set();
    static #openedWarningMessages = new Set();

    /** Synchronizes the external Keeper selector dialog and player confirmation state on prompt render. */
    static onRender(prompt) {
        const sys = prompt.session;
        const messageId = prompt._messageId;
        if (!sys || !messageId) return;

        if (sys.isResolved) {
            this.#openedSelectorMessages.delete(messageId);
            this.#openedWarningMessages.delete(messageId);
            return;
        }

        if (game.user?.isGM && sys.pushConsequenceRequest) {
            if (!this.#openedSelectorMessages.has(messageId)) {
                this.#openedSelectorMessages.add(messageId);
                openPushConsequenceSelector(messageId);
            }
            return;
        }

        if (!game.user?.isGM && sys.pushConsequenceReady && !this.#openedWarningMessages.has(messageId)) {
            const button = prompt.element?.querySelector("[data-action='pushRoll']");
            if (!button) return;
            this.#openedWarningMessages.add(messageId);
            button.click();
        }
    }
}
