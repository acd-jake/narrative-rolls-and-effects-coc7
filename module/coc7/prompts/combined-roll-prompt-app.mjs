import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy } from "../../core-bridge.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

const COMBINED_ROLL_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/combined-roll-prompt.hbs";

/** Creates a prompt that applies one percentile result to both checks in a combined roll. */
export function createCombinedRollPromptApp(core) {
    const CorePromptApp = core.createPromptClass({ template: COMBINED_ROLL_TEMPLATE });
    return class CombinedRollPromptApp extends CorePromptApp {
    static DEFAULT_OPTIONS = {
        actions: {
            executeCombinedRoll: CombinedRollPromptApp.#onExecuteCombinedRoll
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.session;
        const [first, second] = sys?.participants ?? [];

        const firstOpts = this._evaluateParticipantOptions(first, sys);
        const secondOpts = this._evaluateParticipantOptions(second, sys);

              const canSpendAnyLuck = Boolean(firstOpts.canSpendLuck || secondOpts.canSpendLuck);
      const hasPendingCombinedAction = Boolean(canSpendAnyLuck || canPushCombined);
      const declineCombinedLabel = canSpendAnyLuck && canPushCombined
          ? game.i18n.localize("ROE_COC7.RollSession.DeclineLuckAndPushBtn")
          : canSpendAnyLuck
              ? game.i18n.localize("ROE_COC7.RollSession.DeclineLuckBtn")
              : canPushCombined
                  ? game.i18n.localize("ROE_COC7.RollSession.DeclinePushBtn")
                  : "";


        // Push is available if the combined check failed overall and neither part was pushed yet
        const overallPassed =
            sys?.combinedMode === "or"
                ? Boolean(first?.isSuccess || second?.isSuccess)
                : Boolean(first?.isSuccess && second?.isSuccess);

        // A combined roll is pushed as one result, so both checks must still be eligible.
        const canPushCombined = Boolean(
            first?.hasRolled &&
            !sys?.isResolved &&
            !overallPassed &&
            (firstOpts.canPush || secondOpts.canPush)
        );

        const modDice = sys?.participants?.[0]?.modifierDice ?? 0;
        const rollDiceArray = context.rollDice ?? [];

        return {
            ...context,
            actorName: first?.actorName?.toUpperCase() ?? "",
            combinedModeLabel: game.i18n.localize(
                sys?.combinedMode === "or" ? "ROE_COC7.RollSession.ModeOr" : "ROE_COC7.RollSession.ModeAnd"
            ),
            first: first ? { ...first, ...firstOpts } : null,
            second: second ? { ...second, ...secondOpts } : null,
            canPushCombined,
            modifierDice: modDice,
            modifierDisplay: this._formatModifierLabel(modDice),
            rollDiceLabel: this._formatDiceFormulaLabel(rollDiceArray),
            canRoll: Boolean(first && !first.hasRolled && (game.user.isGM || SessionStore.resolveActor(first)?.isOwner)),
            isDelegatedToPlayer: this._isDelegatedToActivePlayer(first),
            hasPendingCombinedAction,
            declineCombinedLabel
        };
    }

    static async #onExecuteCombinedRoll() {
        const sys = this.session;
        const [first, second] = sys?.participants ?? [];
        if (!first || !second || first.hasRolled) return;

        const modifierDice = first.modifierDice ?? 0;
        const formula = CoC7CheckResolver.buildRollFormula(modifierDice);
        const roll = await new Roll(formula).evaluate();
        const total = roll.total === 0 ? 100 : roll.total;
        const rank = CoC7CheckResolver.LEVEL_RANK;
        const reqRank = rank[sys.difficulty] ?? 2;

        // Both participants share this die result but resolve it against their own target.
        for (const part of [first, second]) {
            const successLevel = CoC7CheckResolver.evaluateResult(total, part.targetValue);
            const isSuccess = (rank[successLevel] ?? 0) >= reqRank;
            const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, Number(part.targetValue), successLevel, { modifierDice });

            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, part.key, {
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
}

