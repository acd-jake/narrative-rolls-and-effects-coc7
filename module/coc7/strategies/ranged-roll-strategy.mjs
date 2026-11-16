import { SessionStore } from "../../core-bridge.mjs";
import { CombatRollStrategy } from "./combat-roll-strategy.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/**
 * Ranged attack in three sequential phases: target reaction (diving for cover),
 * the shooter's simple attack roll, and damage with consequences.
 */
export class RangedRollStrategy extends CombatRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("ranged"))(options).render(true);
    }

    /** @override */
    async onRollApplied(participant, state) {
        if (!participant?.hasRolled) return [];

        if (participant.key === "defender") {
            state.combatPhase = "attack";
            return [];
        }

        if (participant.key === "attacker") {
            state.combatPhase = "resolution";
            const followUps = await this._advanceToResolution(state);
            this.#flagPendingCoverConsequence(state);
            return followUps;
        }

        const followUps = await super.onRollApplied(participant, state);
        this.#flagPendingCoverConsequence(state);
        return followUps;
    }

    /** @override */
    _determineHitWinner(state) {
        const rank = BaseRollStrategy.LEVEL_RANK;
        const attacker = state.participants.find((p) => p.key === "attacker");
        const requiredRank = rank[state.difficulty] ?? rank.regular;
        return (rank[attacker?.successLevel] ?? 0) >= requiredRank ? "attacker" : "";
    }

    /** @override */
    async applyConsequences(state) {
        await super.applyConsequences(state);

        if (!this.#targetTookCover(state)) return;
        const target = state.participants?.find((p) => p.key === "defender");
        const targetActor = SessionStore.resolveActor(target);
        if (targetActor) await CoC7DataMapper.setCondition(targetActor, "prone", true);
    }

    #targetTookCover(state) {
        return Boolean(state.participants?.find((p) => p.key === "defender")?.tookCover);
    }

    #flagPendingCoverConsequence(state) {
        if (this.#targetTookCover(state) && !state.consequencesApplied) {
            state.hasPendingConsequences = true;
        }
    }
}
