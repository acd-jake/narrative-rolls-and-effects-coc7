import { RollVisibilityPolicy, SessionStore } from "../../core-bridge.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";
import { PUSH_CONSEQUENCES_SETTING } from "../coc7-constants.mjs";
import { getPushDefaults } from "../push-consequence-defaults.mjs";
import { getSkillKey } from "../push-consequence-editor.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

/** Resolves, enriches, and formats pushed-roll consequences for prompts and chat cards. */
export class CoC7PushConsequenceService {
    /** Returns true when the participant's actor is an investigator. */
    static isInvestigator(participant) {
        const actor = SessionStore.resolveActor(participant);
        return Boolean(actor && actor.type === "character");
    }

    /** Returns true when the actor currently has temporary or indefinite insanity. */
    static isActorInsane(actor) {
        if (!actor?.statuses) return false;
        return Boolean(actor.statuses.has("tempoInsane") || actor.statuses.has("indefInsane"));
    }

    /** Resolves all configured or default consequence entries for the rolled participant's skill. */
    static getSkillConsequences(participant, isInsane) {
        const actor = SessionStore.resolveActor(participant);
        const item = participant?.itemId ? actor?.items?.get?.(participant.itemId) : null;
        const skillKey = item ? getSkillKey(item) : this.#buildFallbackSkillKey(participant?.label);
        if (!skillKey) return [];

        const language = game.i18n?.lang === "de" ? "de" : "en";
        const savedAll = game.settings?.get?.(COC7_MODULE_ID, PUSH_CONSEQUENCES_SETTING) ?? {};
        const entries = savedAll[language]?.[skillKey]?.entries ?? getPushDefaults(language, skillKey);

        return entries
            .map((entry, index) => ({ ...entry, index }))
            .filter((entry) => Boolean(entry.insane) === Boolean(isInsane));
    }

    static #buildFallbackSkillKey(label) {
        const clean = String(label ?? "").trim().toLocaleLowerCase();
        return clean ? `name:${clean}` : "";
    }

    /** Enriches a plain or HTML string for display in prompts, dialogs, or chat cards. */
    static async enrichHtml(text, { secrets = Boolean(game.user?.isGM) } = {}) {
        const raw = String(text ?? "").trim();
        if (!raw) return "";
        const html = /<[a-z][\s\S]*>/i.test(raw)
            ? raw
            : `<p>${foundry.utils.escapeHTML(raw).replace(/\r?\n/g, "<br>")}</p>`;
        const enrich = foundry.applications?.ux?.TextEditor?.implementation?.enrichHTML;
        return typeof enrich === "function" ? enrich(html, { secrets }) : html;
    }

    /** Builds the Keeper selection UI state when a push consequence request is active. */
    static async buildKeeperSelectionContext(session) {
        const request = session?.pushConsequenceRequest;
        if (!game.user?.isGM || !request || session?.isResolved) {
            return { showPushConsequenceSelector: false };
        }
        const participant = session.participants?.find((p) => p.key === request.participantKey) ?? session.participants?.at(0);
        const isInsane = Boolean(request.isInsane);
        const options = this.getSkillConsequences(participant, isInsane);
        const selectedMode = request.selectedMode ?? (options.length > 0 ? "0" : "__none__");
        const selectedIndex = Number(selectedMode);
        const activePreset = !Number.isNaN(selectedIndex) ? options[selectedIndex] ?? null : null;

        return {
            showPushConsequenceSelector: true,
            pushRequestParticipantKey: request.participantKey,
            pushRequestIsInsane: isInsane,
            pushConsequenceOptions: options.map((opt, idx) => ({
                value: String(idx),
                title: opt.title,
                selected: selectedMode === String(idx)
            })),
            isCustomConsequenceSelected: selectedMode === "__custom__",
            isNoConsequenceSelected: selectedMode === "__none__",
            customConsequenceTitle: request.customTitle ?? "",
            customConsequenceDescription: request.customDescription ?? "",
            customConsequenceNarration: request.customNarration ?? "",
            customConsequenceForeshadowing: request.customForeshadowing ?? "",
            previewForeshadowingHtml: activePreset ? await this.enrichHtml(activePreset.foreshadowing) : "",
            previewDescriptionHtml: activePreset ? await this.enrichHtml(activePreset.description) : ""
        };
    }
    /** Builds active foreshadowing (before resolution) and failed-push outcome blocks (after resolution). */
    static async buildDisplayContext(session) {
        const consequence = session?.pushConsequence ?? null;
        if (!consequence) {
            return {
                showGmPushForeshadowing: false,
                showPushOutcomeDetails: false
            };
        }

        const isGM = Boolean(game.user?.isGM);
        const isResolved = Boolean(session?.isResolved);

        // Foreshadowing is shown to the GM only while the session is unresolved, then removed upon resolution.
        if (!isResolved) {
            const foreshadowingHtml = isGM && consequence.foreshadowing
                ? await this.enrichHtml(consequence.foreshadowing, { secrets: true })
                : "";
            return {
                showGmPushForeshadowing: Boolean(foreshadowingHtml),
                pushConsequenceTitle: consequence.title ?? "",
                pushForeshadowingHtml: foreshadowingHtml,
                showPushOutcomeDetails: false
            };
        }

        // After resolution, show narration/description only if the pushed roll failed.
        const pushedParticipants = (session.participants ?? []).filter((p) => p.isPushed);
        const anyPushFailed = pushedParticipants.some((p) => CoC7CheckResolver.didPushFail(session, p.key));
        if (!anyPushFailed) {
            return { showGmPushForeshadowing: false, showPushOutcomeDetails: false };
        }

        const canViewRoll = isGM || (pushedParticipants.length > 0 && pushedParticipants.every((p) =>
            RollVisibilityPolicy.canViewParticipantRoll(p, session)
        ));
        if (!canViewRoll) {
            return { showGmPushForeshadowing: false, showPushOutcomeDetails: false };
        }

        const showNarrationToPlayers = Boolean(game.settings?.get?.(COC7_MODULE_ID, "showPushNarrationToPlayers"));
        const descriptionHtml = isGM && consequence.description
            ? await this.enrichHtml(consequence.description, { secrets: true })
            : "";
        const narrationHtml = (isGM || showNarrationToPlayers) && consequence.narration
            ? await this.enrichHtml(consequence.narration, { secrets: isGM })
            : "";

        return {
            showGmPushForeshadowing: false,
            showPushOutcomeDetails: Boolean(descriptionHtml || narrationHtml),
            showPushDescription: Boolean(descriptionHtml),
            showPushNarration: Boolean(narrationHtml),
            pushConsequenceTitle: consequence.title ?? "",
            pushDescriptionHtml: descriptionHtml,
            pushNarrationHtml: narrationHtml
        };
    }
}
