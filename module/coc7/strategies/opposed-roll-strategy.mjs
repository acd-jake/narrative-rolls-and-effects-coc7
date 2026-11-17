import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";

/**
 * Strategy for Opposed Rolls (comparing success levels and breaking ties by higher skill value).
 */
export class OpposedRollStrategy extends BaseRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("opposed"))(options).render(true);
    }

    /** @override */
    evaluateResolution(state) {
        const rank = BaseRollStrategy.LEVEL_RANK;
        const successful = (state.participants ?? []).filter(
            (p) => (rank[p.successLevel] ?? 0) >= rank.regular
        );

        if (successful.length === 0) {
            return {
                winnerKey: "",
                outcomeHeadline: game.i18n.localize("ROE_COC7.RollSession.OpposedTieFailure")
            };
        }

        successful.sort((a, b) => {
            const rankDiff = (rank[b.successLevel] ?? 0) - (rank[a.successLevel] ?? 0);
            if (rankDiff !== 0) return rankDiff;
            return Number(b.targetValue ?? 0) - Number(a.targetValue ?? 0);
        });

        const winner = successful[0];
        return {
            winnerKey: winner.key,
            outcomeHeadline: game.i18n.format("ROE_COC7.RollSession.OpposedWinner", {
                winner: winner.actorName,
                skill: winner.label,
                level: CoC7ResultFormatter.formatSuccessLevel(winner.successLevel)
            })
        };
    }

        /** @override */
    async onRollApplied(participant, state) {
        if (!participant?.isPushed) return;
        const resolution = this.evaluateResolution(state);
        if (resolution.winnerKey !== participant.key) {
            state.pushFailurePending = true;
        }
    }

}
