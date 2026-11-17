import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy, DiceVisualizer } from "../../core-bridge.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CoC7SessionFactory } from "../coc7-session-factory.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

const SANITY_PROMPT_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/sanity-check-prompt.hbs";

/** Creates the staged Sanity prompt, including its optional Intelligence follow-up. */
export function createSanityCheckPromptApp(core, BasicPromptApp) {
    const ParentPromptApp = core.extendPromptClass(BasicPromptApp, { template: SANITY_PROMPT_TEMPLATE });
    return class SanityCheckPromptApp extends ParentPromptApp {
    static DEFAULT_OPTIONS = {
        actions: {
            executeIntCheck: SanityCheckPromptApp.#onExecuteIntCheck,
            resetSanityPhase: SanityCheckPromptApp.#onResetSanityPhase
        }
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.session;
        if (!sys) return context;

        const enriched = CoC7SessionFactory.enrichForTemplate(sys);
        const sanRoll = sys.participants?.find((p) => p.key === "p0") ?? sys.participants?.at(0);
        const intRoll = sys.participants?.find((p) => p.key === "insanityInt") ?? null;

        const actor = SessionStore.resolveActor(sanRoll);
        const isOwner = Boolean(actor && (game.user.isGM || actor.isOwner));

        const targetSan = Number(sanRoll?.targetValue ?? 0);
        const lost = Number(sys.sanityLost ?? 0);
        const genericLabel = game.i18n.localize("ROE_COC7.Resources.Sanity");
        const checkTypeLabel = game.i18n.localize("ROE_COC7.RollSession.Types.sanity");
        const sanityReason = sys.title && sys.title !== genericLabel && sys.title !== checkTypeLabel
            ? sys.title
            : "";
        const intOutcome = intRoll?.hasRolled
            ? CoC7ResultFormatter.formatRollOutcome({
                total: intRoll.total,
                targetValue: intRoll.targetValue,
                successLevel: intRoll.successLevel
            })
            : "";

        const isPhaseCheck = !sanRoll?.hasRolled;
        const canViewSanRoll = sanRoll ? RollVisibilityPolicy.canViewParticipantRoll(sanRoll, sys) : false;
        const sanityCheckOutcome = sanRoll?.hasRolled
            ? canViewSanRoll
                ? CoC7ResultFormatter.formatRollOutcome({
                    total: sanRoll.total,
                    targetValue: sanRoll.targetValue,
                    successLevel: sanRoll.successLevel
                })
                : game.i18n.localize("ROE.RollSession.HiddenRoll")
            : "";
        const isPhaseInsight = !isPhaseCheck && Boolean(intRoll) && !intRoll.hasRolled;
        const manualMod = Number(sanRoll?.modifierDice ?? 0);
        const rollDiceArray = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, manualMod);
        const intDiceArray = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, intRoll?.modifierDice ?? 0);

        return {
            ...context,
            ...enriched,
            manualModifierDice: manualMod,
            flagModifierDice: 0,
            effectiveModifierLabel: this._formatModifierLabel(manualMod),
            rollDiceLabel: this._formatDiceFormulaLabel(rollDiceArray),
            isPhaseCheck,
            sanityCheckOutcome,
            isPhaseInsight,
            isPhaseResolution: !isPhaseCheck && !isPhaseInsight,
            title: checkTypeLabel,
            displayTarget: targetSan,
            targetValue: targetSan,
            isSanityCheck: true,
            showLevel: false,
            canSpendLuck: false,
            canPush: false,
            sanityReason,
            hasSanityLossResult: enriched.hasSanityResult,
            sanityLost: lost,
            sanityFlavorText: this.#resolveFlavorText(lost, Boolean(sanRoll?.isSuccess)),
            isInsanityTriggered: Boolean(enriched.sanityInsanityBadge),
            hasIntCheck: Boolean(intRoll),
            intCheckLabel: intRoll?.label ?? "",
            intTargetValue: intRoll?.targetValue ?? 0,
            intModifierDice: intRoll?.modifierDice ?? 0,
            intModifierLabel: this._formatModifierLabel(intRoll?.modifierDice ?? 0),
            intDice: intDiceArray,
            intDiceLabel: this._formatDiceFormulaLabel(intDiceArray),
            intHasRolled: Boolean(intRoll?.hasRolled),
            intOutcome,
            canRollIntCheck: Boolean(intRoll && !intRoll.hasRolled && isOwner && !sys.isResolved),
            isDelegatedToPlayer: this._isDelegatedToActivePlayer(sanRoll),
            isIntDelegatedToPlayer: this._isDelegatedToActivePlayer(intRoll)
        };
    }

    /** @override */
    _getPhases(sys) {
        const sanRoll = sys?.participants?.find((p) => p.key === "p0") ?? sys?.participants?.at(0);
        const intRoll = sys?.participants?.find((p) => p.key === "insanityInt");
        const inCheck = !sanRoll?.hasRolled;
        const inInsight = !inCheck && Boolean(intRoll) && !intRoll.hasRolled;

        const phases = [{ id: "check", isActive: inCheck, isCompleted: !inCheck }];
        if (intRoll) phases.push({ id: "insight", isActive: inInsight, isCompleted: !inCheck && !inInsight });
        phases.push({ id: "resolution", isActive: !inCheck && !inInsight, isCompleted: false });
        return phases;
    }

    /** @override */
    _buildPhaseSummary(sys) {
        const insight = this._getPhases(sys).find((p) => p.id === "insight");
        if (!insight?.isActive) return "";

        const sanRoll = sys.participants?.find((p) => p.key === "p0") ?? sys.participants?.at(0);
        return game.i18n.format("ROE_COC7.Sanity.Summary.Insight", {
            actor: sanRoll?.actorName ?? "",
            lost: Number(sys.sanityLost ?? 0)
        });
    }

    #resolveFlavorText(lost, isSuccess) {
        if (lost <= 0) return game.i18n.localize("ROE_COC7.Sanity.FlavorUnshaken");
        if (lost >= 5) return game.i18n.localize("ROE_COC7.Sanity.FlavorShattered");
        return game.i18n.localize(
            isSuccess ? "ROE_COC7.Sanity.FlavorShakenMinor" : "ROE_COC7.Sanity.FlavorShakenMajor"
        );
    }

    static async #onResetSanityPhase(event, target) {
        if (!game.user.isGM || !target.dataset.phase) return;
        await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { resetSanityPhase: target.dataset.phase });
    }

    static async #onExecuteIntCheck() {
        const sys = this.session;
        const intRoll = sys?.participants?.find((p) => p.key === "insanityInt");
        if (!intRoll || intRoll.hasRolled || sys.isResolved) return;

        // The follow-up check resolves temporary-insanity duration after a bout is triggered.
        const modifierDice = intRoll.modifierDice ?? 0;
        const formula = CoC7CheckResolver.buildRollFormula(modifierDice);
        const roll = await new Roll(formula).evaluate();
        const total = roll.total === 0 ? 100 : roll.total;
        const successLevel = CoC7CheckResolver.evaluateResult(total, Number(intRoll.targetValue));
        const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, Number(intRoll.targetValue), successLevel, { modifierDice });
        const isSuccess = (CoC7CheckResolver.LEVEL_RANK[successLevel] ?? 0) >= 2;

        await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "insanityInt", {
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

