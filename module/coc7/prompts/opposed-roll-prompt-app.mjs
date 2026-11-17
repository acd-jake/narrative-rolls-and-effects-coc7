import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy, DiceVisualizer } from "../../core-bridge.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

const OPPOSED_ROLL_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/opposed-roll-prompt.hbs";

/** Creates the opposed-roll prompt, including per-contestant rolls and visibility rules. */
export function createOpposedRollPromptApp(core) {
    const CorePromptApp = core.createPromptClass({ template: OPPOSED_ROLL_TEMPLATE });
    return class OpposedRollPromptApp extends CorePromptApp {
    /** @type {Map<string, number>} */
    #modifierDiceByKey = new Map();

    static DEFAULT_OPTIONS = {
        actions: {
            setContestantModifier: OpposedRollPromptApp.#onSetContestantModifier,
            rollContestant: OpposedRollPromptApp.#onRollContestant
        }
    };

    /** @override */
    _getPhases(sys) {
        return (sys?.participants ?? []).map((p) => ({ id: p.key, isActive: !p.hasRolled, isCompleted: p.hasRolled }));
    }

    /** @override */
    _buildPhaseSummary(sys) {
        const names = (sys.participants ?? []).map((p) => p.actorName).join(" vs. ");
        return game.i18n.format("ROE_COC7.RollSession.Summary.Opposed", { title: sys.title ?? "", names });
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.session;
        const rawParticipants = sys?.participants ?? [];

        const enriched = rawParticipants.map((p) => {
            const actor = SessionStore.resolveActor(p);
            const isOwner = Boolean(actor?.isOwner);
            const opts = this._evaluateParticipantOptions(p, sys);
            const modDice = p.modifierDice ?? 0;
            const diceArray = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, modDice);

            return {
                ...p,
                ...opts,
                isOwner,
                isDelegatedToPlayer: this._isDelegatedToActivePlayer(p),
                modifierDice: modDice,
                modifierDisplay: this._formatModifierLabel(modDice),
                dice: diceArray,
                diceLabel: this._formatDiceFormulaLabel(diceArray)
            };
        });

        const hasPendingOwnAction =
            !game.user.isGM && enriched.some((p) => p.isOwner && p.hasRolled && (p.canSpendLuck || p.canPush));

        const canRevealOpposedResults =
            game.user.isGM || (context.allRolled && !hasPendingOwnAction) || Boolean(sys?.isResolved);

        const participants = enriched.map((p, index) => {
            const showDetails = game.user.isGM || p.isOwner || canRevealOpposedResults;
            const canRoll = !p.hasRolled && (game.user.isGM || p.isOwner);
            return {
                ...p,
                phaseNumber: index + 1,
                isPhaseActive: !p.hasRolled,
                hiddenInCompact: p.hasRolled ? (!p.canSpendLuck && !p.canPush) : !canRoll,
                canRoll,
                statusText: p.hasRolled
                    ? showDetails
                        ? CoC7ResultFormatter.formatRollOutcome({
                            total: p.total,
                            targetValue: p.targetValue,
                            successLevel: p.successLevel
                        })
                        : game.i18n.localize("ROE_COC7.Combat.Card.HiddenUntilOwnRoll")
                    : game.i18n.localize("ROE_COC7.Combat.Card.PendingRoll")
            };
        });

        return {
            ...context,
            title: sys?.title ?? "",
            participants
        };
    }

    static async #onSetContestantModifier(event, target) {
        const key = target.dataset.key;
        const sys = this.session;
        const participant = sys?.participants?.find((p) => p.key === key);
        if (!participant || participant.hasRolled || sys.isResolved) return;

        const current = participant.modifierDice ?? 0;
        const step = Number(target.dataset.step);
        const next = !Number.isNaN(step)
            ? Math.clamp(current + step, -2, 2)
            : current >= 2
                ? -2
                : current + 1;

        await UniversalRollOrchestrator.setParticipantModifier(this._messageId, key, next);
    }

    static async #onRollContestant(event, target) {
        const key = target.dataset.key;
        const sys = this.session;
        const participant = sys?.participants?.find((p) => p.key === key);
        if (!participant || participant.hasRolled) return;

        const modDice = participant.modifierDice ?? 0;
        const formula = CoC7CheckResolver.buildRollFormula(modDice);
        const roll = await new Roll(formula).evaluate();
        const total = roll.total === 0 ? 100 : roll.total;
        const successLevel = CoC7CheckResolver.evaluateResult(total, Number(participant.targetValue));
        const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, Number(participant.targetValue), successLevel, { modifierDice: modDice });
        const isSuccess = (CoC7CheckResolver.LEVEL_RANK[successLevel] ?? 0) >= 2;

        await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, key, {
            total,
            successLevel,
            isSuccess,
            modifierDice: modDice,
            rollMode: RollVisibilityPolicy.getCurrentRollMode(),
            rollerUserId: game.user.id,
            rollBreakdown
        });
    }
    };
}

