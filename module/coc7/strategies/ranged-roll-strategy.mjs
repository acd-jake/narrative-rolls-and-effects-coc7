import { MODULE_ID, SessionStore } from "../../core-bridge.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { CombatConsequenceApplier } from "./combat-consequence-applier.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { RangedCombatRules } from "../ranged/ranged-combat-rules.mjs";

/**
 * Standalone strategy for Call of Cthulhu 7e ranged combat:
 * target cover reaction, shot/burst/full-auto sequence, and per-bullet damage resolution.
 */
export class RangedRollStrategy extends BaseRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("ranged"))(options).render(true);
    }

    /** @override */
    async onRollApplied(participant, state) {
        if (!participant?.hasRolled || participant.isShotDetail) return [];

        if (participant.key === "defender") {
            state.combatPhase = "attack";
            return [];
        }

        if (participant.key === "attacker") {
            state.combatPhase = "resolution";
            const followUps = await this.#advanceToResolution(state);
            this.#flagPendingCoverConsequence(state);
            return followUps;
        }

        if (participant.key === "damage") {
            await this.#resolveDamageOutcome(state, participant);
            this.#flagPendingCoverConsequence(state);
            return [];
        }

        return [];
    }

    async #advanceToResolution(state) {
        const hitWinnerKey = this.#determineHitWinner(state);
        state.hitWinnerKey = hitWinnerKey;

        const alreadyHasDamage = state.participants?.some((p) => p.key === "damage");
        if (!hitWinnerKey || alreadyHasDamage) return [];

        const winner = state.participants.find((p) => p.key === hitWinnerKey);
        const winnerActor = SessionStore.resolveActor(winner);
        if (!winner || !winnerActor) return [];

        const hits = Array.isArray(state.rangedHits) ? state.rangedHits : [];
        const hitCount = Math.max(1, hits.length);
        const impaleCount = hits.filter((h) => h.impale).length;
        const baseFormula = hits[0]?.formula || state.damageFormula || "1d6";
        const displayFormula = hitCount > 1 ? `${hitCount}× (${baseFormula})` : baseFormula;

        const damageLabel = impaleCount > 0
            ? `${game.i18n.localize("ROE_COC7.Combat.DamageRoll")} (${game.i18n.localize("ROE_COC7.Combat.ImpalingExtreme")})`
            : game.i18n.localize("ROE_COC7.Combat.DamageRoll");

        return [
            {
                ...SessionStore.buildParticipant("damage", winnerActor, damageLabel, 0),
                diceFormula: displayFormula,
                isFollowUp: true,
                rollMode: winner.rollMode || state.rollMode || "publicroll",
                rollerUserId: winner.rollerUserId || state.initiatorUserId || ""
            }
        ];
    }
    async #resolveDamageOutcome(state, damageParticipant) {
        const defaultTarget = state.participants?.find((p) => p.key === "defender");
        const defaultActor = SessionStore.resolveActor(defaultTarget);
        const hitResults = Array.isArray(state.rangedHitResults) && state.rangedHitResults.length > 0
            ? state.rangedHitResults
            : [{ targetActorId: defaultActor?.id ?? "", rawDamage: Number(damageParticipant.total ?? 0), impale: false }];

        const summary = RangedCombatRules.evaluateMultiHitDamage(hitResults, defaultActor);
        state.rawDamage = summary.rawDamage;
        state.armorApplied = summary.armorApplied;
        state.finalDamage = summary.finalDamage;
        state.majorWoundTriggered = summary.majorWoundTriggered;
        state.rangedDamageByActor = summary.damageByActor;
        state.hasPendingConsequences = (summary.finalDamage > 0 || this.#targetTookCover(state)) && !state.consequencesApplied;

        const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
        if (state.hasPendingConsequences && autoApply) {
            await this.applyConsequences(state);
            state.consequencesApplied = true;
            state.hasPendingConsequences = false;
        }
    }

    #determineHitWinner(state) {
        if (state.rangedMalfunction) return "";
        if (Array.isArray(state.rangedHits) && state.rangedHits.length > 0) return "attacker";
        const rank = BaseRollStrategy.LEVEL_RANK;
        const attacker = state.participants.find((p) => p.key === "attacker");
        const requiredRank = rank[state.difficulty] ?? rank.regular;
        return (rank[attacker?.successLevel] ?? 0) >= requiredRank ? "attacker" : "";
    }

    /** @override */
    async applyConsequences(state) {
        for (const [actorId, info] of Object.entries(state.rangedDamageByActor ?? {})) {
            const targetActor = game.actors?.get?.(actorId);
            await CombatConsequenceApplier.applyDamageToActor(targetActor, info?.damage, Boolean(info?.majorWound));
        }

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
