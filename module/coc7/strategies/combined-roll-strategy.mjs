import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";

/**
 * Strategy for Combined Rolls (evaluating one 1d100 roll against two checks with AND/OR logic).
 */
export class CombinedRollStrategy extends BaseRollStrategy {
    async onRollApplied(participant, state) {
        if (!participant?.isPushed || !state.participants?.every((entry) => entry.isPushed)) return;
        const passed = state.combinedMode === "or"
            ? state.participants.some((entry) => entry.isSuccess)
            : state.participants.every((entry) => entry.isSuccess);
        if (!passed) state.pushFailurePending = true;
    }

    /** @override */
    renderPrompt(options) {
        new (getPromptApp("combined"))(options).render(true);
    }

    /** @override */
    evaluateResolution(state) {
        const [first, second] = state.participants ?? [];
        if (!first || !second) return { winnerKey: "", outcomeHeadline: "" };

        const passed =
            state.combinedMode === "or"
                ? Boolean(first.isSuccess || second.isSuccess)
                : Boolean(first.isSuccess && second.isSuccess);

        const headlineKey = passed ? "ROE_COC7.RollSession.CombinedSuccess" : "ROE_COC7.RollSession.CombinedFailure";
        return {
            winnerKey: passed ? first.key : "",
            outcomeHeadline: game.i18n.format(headlineKey, { actor: first.actorName, roll: first.total })
        };
    }
}
