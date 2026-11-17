import { UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { CoC7SessionFactory } from "../coc7-session-factory.mjs";

/** Builds and dispatches Call of Cthulhu roll requests from the GM composer form. */
export class CoC7RequestComposer {

    /** Defines the roll-type tabs displayed by the request composer. */
    getRequestComposerTabs() {
        const tabDefinitions = [
            ["skill", "fa-dice-d20"],
            ["sanity", "fa-brain"],
            ["combined", "fa-code-merge"],
            ["opposed", "fa-scale-balanced"],
            ["other", "fa-cubes"]
        ];
        return tabDefinitions.map((definition) => this.#createRequestTab(...definition));
    }

    /** Returns the Handlebars template used for CoC7 request fields. */
    getRequestComposerTemplate() {
        return "modules/narrative-rolls-and-effects-coc7/templates/dialogs/coc7-request-fields.hbs";
    }

    /** Builds request-form context and available checks for the selected actors. */
    getRequestComposerContext(rollType, { actorA, actorB }) {
        return {
            rollType,
            isSkill: rollType === "skill",
            isSanity: rollType === "sanity",
            isCombined: rollType === "combined",
            isOpposed: rollType === "opposed",
            isOther: rollType === "other",
            checksA: actorA ? CoC7SessionFactory.collectActorChecks(actorA, { includeSpecial: rollType === "skill" }) : [],
            checksB: actorB ? CoC7SessionFactory.collectActorChecks(actorB, { includeSpecial: false }) : []
        };
    }

    /** Starts a roll session from the composer form, returning false if the primary actor is missing. */
    async dispatchRequestComposer(rollType, form, { prepareModifiers }) {
        const actorA = game.actors.get(form.querySelector("select[name='actorA']")?.value);
        if (!actorA) return false;

        if (rollType === "skill") {
            await this.#dispatchSkillRequest(actorA, form, prepareModifiers);
        } else if (rollType === "sanity") {
            await this.#dispatchSanityRequest(actorA, form, prepareModifiers);
        } else if (rollType === "combined") {
            await this.#dispatchCombinedRequest(actorA, form, prepareModifiers);
        } else if (rollType === "opposed") {
            await this.#dispatchOpposedRequest(actorA, form, prepareModifiers);
        } else if (rollType === "other") {
            await this.#dispatchOtherRequest(actorA, form, prepareModifiers);
        } else {
            throw new Error(`Unknown Call of Cthulhu request type "${rollType}".`);
        }
        return true;
    }

    async #dispatchSkillRequest(actor, form, prepareModifiers) {
        const parsed = this.#parseCheckOption(form.querySelector("select[name='skillCheck']")?.value);
        const difficulty = form.querySelector("select[name='difficulty']")?.value || "regular";
        const item = parsed.itemId ? actor.items.get(parsed.itemId) : null;
        await UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            item,
            label: parsed.label,
            targetValue: parsed.targetValue,
            difficulty: parsed.isLuck ? "regular" : difficulty,
            canChangeDifficulty: !parsed.isLuck,
            canPush: !parsed.isLuck && item?.system?.properties?.push !== false,
            prepareModifiers
        });
    }

    async #dispatchSanityRequest(actor, form, prepareModifiers) {
        const label = form.querySelector("input[name='sanityLabel']")?.value.trim()
            || game.i18n.localize("ROE_COC7.Resources.Sanity");
        const lossSuccess = form.querySelector("input[name='lossSuccess']")?.value.trim() || "0";
        const lossFailure = form.querySelector("input[name='lossFailure']")?.value.trim() || "1d6";
        await UniversalRollOrchestrator.startSystemRoll("sanity", {
            actor, label, lossSuccess, lossFailure, prepareModifiers
        });
    }

    async #dispatchCombinedRequest(actor, form, prepareModifiers) {
        const firstCheck = this.#parseCheckOption(form.querySelector("select[name='combinedCheck1']")?.value);
        const secondCheck = this.#parseCheckOption(form.querySelector("select[name='combinedCheck2']")?.value);
        const combinedMode = form.querySelector("select[name='combinedMode']")?.value || "and";
        const difficulty = form.querySelector("select[name='difficulty']")?.value || "regular";
        await UniversalRollOrchestrator.startSystemRoll("combined", {
            actor,
            checks: [firstCheck, secondCheck],
            combinedMode,
            difficulty,
            prepareModifiers
        });
    }

    async #dispatchOpposedRequest(actorA, form, prepareModifiers) {
        const actorB = this.#findAvailableActor(form.querySelector("select[name='actorB']")?.value);
        if (!actorB) return;
        const checkA = this.#parseCheckOption(form.querySelector("select[name='opposedCheckA']")?.value);
        const checkB = this.#parseCheckOption(form.querySelector("select[name='opposedCheckB']")?.value);
        const title = form.querySelector("input[name='opposedTitle']")?.value.trim()
            || `${checkA.label} vs. ${checkB.label}`;
        await UniversalRollOrchestrator.startSystemRoll("opposed", {
            title,
            prepareModifiers,
            contestants: [
                { actor: actorA, itemId: checkA.itemId, label: checkA.label, targetValue: checkA.targetValue, canPush: checkA.canPush },
                { actor: actorB, itemId: checkB.itemId, label: checkB.label, targetValue: checkB.targetValue, canPush: checkB.canPush }
            ]
        });
    }

    async #dispatchOtherRequest(actor, form, prepareModifiers) {
        const label = form.querySelector("input[name='otherLabel']")?.value.trim()
            || game.i18n.localize("ROE_COC7.RollSession.Types.other");
        const diceFormula = form.querySelector("input[name='diceFormula']")?.value.trim() || "1d100";
        await UniversalRollOrchestrator.startSystemRoll("basic", {
            actor, label, diceFormula, isOther: true, prepareModifiers
        });
    }

    #parseCheckOption(raw) {
        // Request-composer values encode kind, item ID, label, target, and push eligibility separated by pipes.
        const [kind, itemId, label, value, pushFlag] = (raw ?? "char||Check|50|1").split("|");
        const isLuck = kind === "luck";
        return {
            isLuck,
            itemId: itemId || null,
            label: label || "Check",
            targetValue: Number(value) || 50,
            canPush: !isLuck && pushFlag !== "0"
        };
    }

    #findAvailableActor(actorId) {
        const tokenActor = canvas?.tokens?.placeables?.find((token) => token.actor?.id === actorId)?.actor;
        return tokenActor ?? game.actors.get(actorId) ?? null;
    }

    #createRequestTab(id, icon) {
        return { id, icon, label: game.i18n.localize(`ROE_COC7.RollSession.Types.${id}`) };
    }
}
