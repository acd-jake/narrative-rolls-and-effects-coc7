import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";

export class BasicRollStrategy extends BaseRollStrategy {
    async onRollApplied(participant, state) {
        if (participant?.isPushed && !participant.isSuccess) state.pushFailurePending = true;
    }

    /** @override */
    evaluateResolution(state) {
        const p = state.participants?.at(0);
        if (!p) return { winnerKey: "", outcomeHeadline: "" };

        if (state.rollType === "other") {
            return {
                winnerKey: p.key,
                outcomeHeadline: `${p.label}: ${p.total}`
            };
        }

        const levelSummary = CoC7ResultFormatter.formatSuccessLevel(p.successLevel);
        return {
            winnerKey: p.isSuccess ? p.key : "",
            outcomeHeadline: `${p.actorName}: ${levelSummary}`
        };
    }
}
