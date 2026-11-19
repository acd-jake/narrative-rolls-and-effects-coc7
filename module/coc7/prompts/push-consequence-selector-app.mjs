import { SessionStore, UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";
import { CoC7PushConsequenceService } from "../adapter/coc7-push-consequence-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Standalone ApplicationV2 dialog allowing the Keeper to choose or customize pushed-roll consequences. */
export class PushConsequenceSelectorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #messageId;
    #updateHookId;
    #isInsane = null;
    #selectedMode = null;
    #customFields = { title: "", description: "", narration: "", foreshadowing: "" };

    constructor({ messageId }, options = {}) {
        super(options);
        this.#messageId = messageId;
        this.#updateHookId = Hooks.on("roeRollSessionUpdated", (message, session) => {
            if (message.id !== this.#messageId) return;
            if (!session?.pushConsequenceRequest || session.isResolved) {
                this.close();
                return;
            }
            this.render();
        });
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        classes: ["roe-overlay", "gm-request-dialog", "push-consequence-dialog"],
        position: { width: 520, height: "auto" },
        window: {
            title: "ROE_COC7.Roll.PushConsequenceSelectTitle",
            resizable: true,
            frame: true,
            positioned: true
        },
        actions: {
            selectOption: PushConsequenceSelectorApp.#onSelectOption,
            confirmSelection: PushConsequenceSelectorApp.#onConfirmSelection
        }
    };

    static PARTS = {
        form: {
            template: `modules/${COC7_MODULE_ID}/templates/dialogs/push-consequence-selector.hbs`
        }
    };

    /** Opens or focuses the consequence selector window for a session message. */
    static openForSession(messageId) {
        if (!game.user?.isGM || !messageId) return;
        const appId = `roe-push-consequence-selector-${messageId}`;
        const existing = foundry.applications.instances.get(appId);
        if (existing) {
            existing.render({ force: true });
            return;
        }
        new PushConsequenceSelectorApp({ messageId }, { id: appId }).render({ force: true });
    }

    get session() {
        return SessionStore.getSession(game.messages.get(this.#messageId));
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const session = this.session;
        const request = session?.pushConsequenceRequest;
        if (!request) return { ...context, hasRequest: false };

        if (this.#isInsane === null) this.#isInsane = Boolean(request.isInsane);
        const participant = session.participants?.find((p) => p.key === request.participantKey) ?? session.participants?.at(0);
        const rawPresets = CoC7PushConsequenceService.getSkillConsequences(participant, this.#isInsane);

        if (this.#selectedMode === null) {
            this.#selectedMode = rawPresets.length > 0 ? "0" : "__none__";
        } else if (this.#selectedMode !== "__custom__" && this.#selectedMode !== "__none__" && !rawPresets[Number(this.#selectedMode)]) {
            this.#selectedMode = rawPresets.length > 0 ? "0" : "__none__";
        }
        const presets = await Promise.all(rawPresets.map(async (entry, idx) => ({
            value: String(idx),
            title: entry.title,
            descriptionHtml: await CoC7PushConsequenceService.enrichHtml(entry.description, { secrets: true }),
            foreshadowingHtml: await CoC7PushConsequenceService.enrichHtml(entry.foreshadowing, { secrets: true }),
            selected: this.#selectedMode === String(idx)
        })));

        return {
            ...context,
            hasRequest: true,
            actorName: participant?.actorName ?? "",
            skillLabel: participant?.label ?? session?.title ?? "",
            isInsane: this.#isInsane,
            presets,
            isCustomSelected: this.#selectedMode === "__custom__",
            isNoneSelected: this.#selectedMode === "__none__",
            customTitle: this.#customFields.title,
            customDescription: this.#customFields.description,
            customNarration: this.#customFields.narration,
            customForeshadowing: this.#customFields.foreshadowing
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this.element.dataset.nreSystem = game.system.id;
        this.element.querySelector("[name='pushConsequenceInsane']")?.addEventListener("change", (ev) => {
            this.#captureCustomFields();
            this.#isInsane = Boolean(ev.currentTarget.checked);
            if (this.#selectedMode !== "__custom__" && this.#selectedMode !== "__none__") {
                this.#selectedMode = "0";
            }
            this.render();
        });
    }

    #captureCustomFields() {
        const root = this.element;
        if (!root || this.#selectedMode !== "__custom__") return;
        this.#customFields = {
            title: root.querySelector("[name='customConsequenceTitle']")?.value ?? "",
            description: root.querySelector("[name='customConsequenceDescription']")?.value ?? "",
            narration: root.querySelector("[name='customConsequenceNarration']")?.value ?? "",
            foreshadowing: root.querySelector("[name='customConsequenceForeshadowing']")?.value ?? ""
        };
    }

    static #onSelectOption(event, target) {
        this.#captureCustomFields();
        const mode = target.dataset.mode;
        if (!mode || mode === this.#selectedMode) return;
        this.#selectedMode = mode;
        this.render();
    }

    static async #onConfirmSelection() {
        this.#captureCustomFields();
        const session = this.session;
        const request = session?.pushConsequenceRequest;
        if (!request) return this.close();

        const participant = session.participants?.find((p) => p.key === request.participantKey) ?? session.participants?.at(0);
        let consequence = null;

        if (this.#selectedMode === "__custom__") {
            const title = this.#customFields.title.trim() || game.i18n.localize("ROE_COC7.Roll.PushFailureTitle");
            const description = this.#customFields.description.trim();
            const narration = this.#customFields.narration.trim();
            const foreshadowing = this.#customFields.foreshadowing.trim();
            if (description || narration || foreshadowing) {
                consequence = { title, description, narration, foreshadowing, insane: this.#isInsane };
            }
        } else if (this.#selectedMode !== "__none__") {
            const presets = CoC7PushConsequenceService.getSkillConsequences(participant, this.#isInsane);
            const chosen = presets[Number(this.#selectedMode)];
            if (chosen) {
                consequence = {
                    title: chosen.title,
                    description: chosen.description,
                    narration: chosen.narration,
                    foreshadowing: chosen.foreshadowing,
                    insane: Boolean(chosen.insane)
                };
            }
        }

        await UniversalRollOrchestrator.updateSessionPatch(this.#messageId, {
            pushConsequence: consequence,
            pushConsequenceRequest: null,
            pushConsequenceReady: true
        });
        await this.close();
    }

    async close(options = {}) {
        Hooks.off("roeRollSessionUpdated", this.#updateHookId);
        return super.close(options);
    }
}
