import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy } from "../../core-bridge.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

const BASIC_ROLL_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/basic-roll-prompt.hbs";

/** Creates the standard check prompt and its percentile-roll action. */
export function createBasicRollPromptApp(core) {
    const CorePromptApp = core.createPromptClass({ template: BASIC_ROLL_TEMPLATE });
    return class BasicRollPromptApp extends CorePromptApp {
    static DEFAULT_OPTIONS = {
        actions: {
            executeRoll: BasicRollPromptApp.#onExecuteRoll
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.session;
        const p = sys?.participants?.at(0);
        const isOther = sys?.rollType === "other";
        const opts = this._evaluateParticipantOptions(p, sys);

        const displayMode = game.settings?.get(COC7_MODULE_ID, "resultDisplayMode") || "both";
        const showNumbers = isOther || !p?.hasRolled || displayMode !== "level";
        const showLevel = !isOther && Boolean(p?.hasRolled) && displayMode !== "numbers";
        const formattedLevel = p?.successLevel ? CoC7ResultFormatter.formatSuccessLevel(p.successLevel) : "";
        const modDice = p?.modifierDice ?? 0;
        const rollDiceArray = context.rollDice ?? [];
        const skillDescription = await this.#getSkillDescription(p, sys?.rollType);
        const promptDescriptions = skillDescription ? [{ html: skillDescription }] : [];

        return {
            ...context,
            title: sys?.title ?? "",
            rollLabel: p?.label || sys?.title || "",
            actorName: p?.actorName?.toUpperCase() ?? "",
            participantKey: p?.key ?? "",
            isOther,
            diceFormula: sys?.diceFormula ?? "1d100",
            hasRolled: Boolean(p?.hasRolled),
            total: p?.total,
            displayTotal: p?.hasRolled ? p.total : "?",
            hasTarget: !isOther && Number(p?.targetValue ?? 0) > 0,
            showNumbers,
            showLevel,
            formattedLevel,
            successLevel: p?.successLevel ?? "",
            canRoll: Boolean(p && !p.hasRolled && (game.user.isGM || SessionStore.resolveActor(p)?.isOwner)),
            displayTarget: Number(p?.targetValue ?? 0),
            targetValue: Number(p?.targetValue ?? 0),
            canChangeDifficulty: false,
            modifierDisplay: this._formatModifierLabel(modDice),
            rollDiceLabel: this._formatDiceFormulaLabel(rollDiceArray),
            hasPromptDescription: promptDescriptions.length > 0,
            promptDescriptions,
            ...opts
        };
    }

    async #getSkillDescription(participant, rollType) {
        if (rollType !== "skill" || !participant?.itemId) return "";
        const actor = SessionStore.resolveActor(participant);
        const description = actor?.items?.get(participant.itemId)?.system?.description?.value;
        if (typeof description !== "string" || !description.trim()) return "";
        return foundry.applications.ux.TextEditor.implementation.enrichHTML(description);
    }

    static async #onExecuteRoll() {
        const sys = this.session;
        const p = sys?.participants?.[0];
        if (!p || p.hasRolled) return;

        if (sys.rollType === "other") {
            const roll = await new Roll(sys.diceFormula).evaluate();
            const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, 0, "");

            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, p.key, {
                total: roll.total,
                successLevel: "",
                isSuccess: true,
                modifierDice: 0,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id,
                rollBreakdown
            });

            return;
        }

        // Resolve the roll once, then submit both its displayed breakdown and success state.
        const modifierDice = p.modifierDice ?? 0;
        const formula = CoC7CheckResolver.buildRollFormula(modifierDice);
        const roll = await new Roll(formula).evaluate();
        const total = roll.total === 0 ? 100 : roll.total;
        const successLevel = CoC7CheckResolver.evaluateResult(total, Number(p.targetValue));
        const rank = CoC7CheckResolver.LEVEL_RANK;
        const isSuccess = (rank[successLevel] ?? 0) >= (rank[sys.difficulty] ?? 2);
        const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, Number(p.targetValue), successLevel, { modifierDice });

        await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, p.key, {
            total,
            successLevel,
            isSuccess,
            modifierDice,
            rollMode: RollVisibilityPolicy.getCurrentRollMode(),
            rollerUserId: game.user.id,
            rollBreakdown
        });
    }
    };
}
