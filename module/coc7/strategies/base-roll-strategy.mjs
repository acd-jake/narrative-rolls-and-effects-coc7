import { getPromptApp } from "../prompts/prompt-app-registry.mjs";

/**
 * Base strategy for universal CoC 7e roll sessions.
 * Subclasses define roll-type-specific prompt creation, resolution rules, and post-roll effects.
 */
export class BaseRollStrategy {
    static LEVEL_RANK = Object.freeze({
        fumble: 0,
        failure: 1,
        regular: 2,
        hard: 3,
        extreme: 4,
        critical: 5
    });

    /**
     * Instantiates and renders the prompt overlay for this roll type.
     * @param {object} options - { messageId, ownedParticipants }
     */
    renderPrompt(options) {
        new (getPromptApp("basic"))(options).render(true);
    }

    /**
     * Hook executed on the GM client after a participant rolls or spends Luck.
     * @param {object} participant
     * @param {object} state
     */
    async onRollApplied(participant, state) { }

    /**
     * Applies calculated roll consequences (e.g., Sanity loss, Insanity conditions, HP damage)
     * to the target Actor. Executed either immediately or via the GM "Apply Consequences" button.
     * @param {object} state
     */
    async applyConsequences(state) { }

    /**
     * Evaluates the outcome of a completed roll session.
     * @param {object} state
     * @returns {{ winnerKey: string, outcomeHeadline: string }}
     */
    evaluateResolution(state) {
        return { winnerKey: "", outcomeHeadline: "" };
    }

    /**
     * Computes the adjusted target value for Hard or Extreme difficulty.
     */
    getEffectiveTarget(baseTarget, difficulty) {
        const target = Number(baseTarget ?? 0);
        if (difficulty === "hard") return Math.floor(target / 2);
        if (difficulty === "extreme") return Math.floor(target / 5);
        return target;
    }
}
