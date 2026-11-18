import { MODULE_ID, SessionStore } from "../../core-bridge.mjs";
import { CombatRollStrategy } from "./combat-roll-strategy.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/**
 * Ranged attack in three sequential phases: target reaction (diving for cover),
 * the shooter's attack (single, multiple, burst, or full-auto), and multi-hit damage resolution.
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

        if (participant.key === "damage" && Array.isArray(state.rangedHitResults) && state.rangedHitResults.length > 0) {
            await this.#computeMultiHitDamage(state, participant);
            this.#flagPendingCoverConsequence(state);
            return [];
        }

        const followUps = await super.onRollApplied(participant, state);
        this.#flagPendingCoverConsequence(state);
        return followUps;
    }

    /** @override */
    async _advanceToResolution(state) {
        const hitWinnerKey = this._determineHitWinner(state);
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
    async #computeMultiHitDamage(state, damageParticipant) {
        const defaultTarget = CombatRollStrategy.getDamageTarget(state);
        const defaultActor = SessionStore.resolveActor(defaultTarget);
        const damageByActor = new Map();

        let totalRaw = 0;
        let totalArmor = 0;
        let totalFinal = 0;
        let majorWound = false;

        for (const hit of state.rangedHitResults) {
            const actor = (hit.targetActorId ? game.actors?.get?.(hit.targetActorId) : null) ?? defaultActor;
            const armor = Number(CoC7DataMapper.getCombatValue(actor, "armor") ?? actor?.system?.armor?.value ?? 0);
            const raw = Math.max(0, Number(hit.rawDamage ?? 0));
            const final = Math.max(0, raw - armor);
            const maxHp = Number(CoC7DataMapper.getResource(actor, "hp")?.max ?? 10);

            totalRaw += raw;
            totalArmor += armor;
            totalFinal += final;
            if (final > 0 && final >= Math.ceil(maxHp / 2)) majorWound = true;

            if (actor?.id) {
                const prev = damageByActor.get(actor.id) ?? { damage: 0, majorWound: false };
                damageByActor.set(actor.id, {
                    damage: prev.damage + final,
                    majorWound: prev.majorWound || (final > 0 && final >= Math.ceil(maxHp / 2))
                });
            }
        }

        state.rawDamage = totalRaw || Number(damageParticipant.total ?? 0);
        state.armorApplied = totalArmor;
        state.finalDamage = totalFinal;
        state.majorWoundTriggered = majorWound;
        state.rangedDamageByActor = Object.fromEntries(damageByActor.entries());
        state.hasPendingConsequences = (totalFinal > 0 || this.#targetTookCover(state)) && !state.consequencesApplied;

        const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
        if (state.hasPendingConsequences && autoApply) {
            await this.applyConsequences(state);
            state.consequencesApplied = true;
            state.hasPendingConsequences = false;
        }
    }

    /** @override */
    _determineHitWinner(state) {
        if (state.rangedMalfunction) return "";
        if (Array.isArray(state.rangedHits) && state.rangedHits.length > 0) return "attacker";
        const rank = BaseRollStrategy.LEVEL_RANK;
        const attacker = state.participants.find((p) => p.key === "attacker");
        const requiredRank = rank[state.difficulty] ?? rank.regular;
        return (rank[attacker?.successLevel] ?? 0) >= requiredRank ? "attacker" : "";
    }

    /** @override */
    async applyConsequences(state) {
        if (state.rangedDamageByActor && Object.keys(state.rangedDamageByActor).length > 0) {
            for (const [actorId, info] of Object.entries(state.rangedDamageByActor)) {
                const targetActor = game.actors?.get?.(actorId);
                const finalDamage = Number(info?.damage ?? 0);
                if (!targetActor || finalDamage <= 0) continue;

                const hpResource = CoC7DataMapper.getResource(targetActor, "hp") ?? {};
                const currentHp = Number(hpResource.value ?? 0);
                const maxHp = Number(hpResource.max ?? 10);
                const newHp = Math.max(0, currentHp - finalDamage);

                await targetActor.update({ "system.attribs.hp.value": newHp });

                if (finalDamage >= maxHp) {
                    await CoC7DataMapper.setCondition(targetActor, "dead", true);
                } else if (newHp === 0) {
                    await CoC7DataMapper.setCondition(targetActor, "unconscious", true);
                    if (info.majorWound) await CoC7DataMapper.setCondition(targetActor, "dying", true);
                } else if (info.majorWound) {
                    await CoC7DataMapper.setCondition(targetActor, "majorWound", true);
                }
            }
        } else {
            await super.applyConsequences(state);
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
