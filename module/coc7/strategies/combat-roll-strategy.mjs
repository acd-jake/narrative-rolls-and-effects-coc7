import { MODULE_ID } from "../../core-bridge.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { SessionStore } from "../../core-bridge.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

export class CombatRollStrategy extends BaseRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("combat"))(options).render(true);
    }

    /** @override */
    async onRollApplied(participant, state) {
        if (!participant?.hasRolled) return [];

        // PHASE 3B: Damage roll completed -> compute armor mitigation & HP deduction
        if (participant.key === "damage") {
            const targetParticipant = this.#getDamageTarget(state);
            const targetActor = this.#resolveActor(targetParticipant);
            const armor = Number(CoC7DataMapper.getCombatValue(targetActor, "armor") ?? targetActor?.system?.armor?.value ?? 0);
            const rawDamage = Math.max(0, Number(participant.total ?? 0));
            const finalDamage = Math.max(0, rawDamage - armor);

            const maxHp = Number(CoC7DataMapper.getResource(targetActor, "hp")?.max ?? 10);
            const majorWoundTriggered = finalDamage > 0 && finalDamage >= Math.floor(maxHp / 2);

            state.rawDamage = rawDamage;
            state.armorApplied = armor;
            state.finalDamage = finalDamage;
            state.majorWoundTriggered = majorWoundTriggered;
            state.hasPendingConsequences = finalDamage > 0 && !state.consequencesApplied;

            const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
            if (finalDamage > 0 && autoApply) {
                await this.applyConsequences(state);
                state.consequencesApplied = true;
                state.hasPendingConsequences = false;
            }
            return [];
        }

        if (participant.key === "attacker" || participant.key === "defender") {
            const attacker = state.participants?.find((entry) => entry.key === "attacker");
            const defender = state.participants?.find((entry) => entry.key === "defender");
            if (!attacker?.hasRolled || (defender && !defender.hasRolled)) return [];

            state.combatPhase = "resolution";
            return this._advanceToResolution(state);
        }

        return [];
    }

    async _advanceToResolution(state) {
        const hitWinnerKey = this._determineHitWinner(state);
        state.hitWinnerKey = hitWinnerKey;

        const alreadyHasDamage = state.participants?.some((p) => p.key === "damage");
        if (!hitWinnerKey || alreadyHasDamage) return [];

        if (hitWinnerKey === "defender" && state.defenderReaction === "maneuver") {
            state.hasPendingConsequences = true;
            return [];
        }

        const winner = state.participants.find((p) => p.key === hitWinnerKey);
        const winnerActor = this.#resolveActor(winner);
        if (!winner || !winnerActor) return [];

        const isExtremeOrCrit = winner.successLevel === "extreme" || winner.successLevel === "critical";
        const weapon = this.#resolveWinnerWeapon(winnerActor, winner, state);
        const rawDmgFormula = weapon?.system?.range?.normal?.damage || state.damageFormula || "1d6";
        const bonus = CoC7DataMapper.getCombatValue(winnerActor, "damageBonus") || "0";
        const isMelee = state.combatType === "melee" || winner.key === "defender";
        const fullFormula = isMelee && bonus && bonus !== "0" ? `${rawDmgFormula}+${bonus}` : rawDmgFormula;

        const damageLabel = isExtremeOrCrit
            ? `${game.i18n.localize("ROE_COC7.Combat.DamageRoll")} (${game.i18n.localize("ROE_COC7.Combat.ImpalingExtreme")})`
            : game.i18n.localize("ROE_COC7.Combat.DamageRoll");

        return [
            {
                ...SessionStore.buildParticipant("damage", winnerActor, damageLabel, 0),
                diceFormula: fullFormula,
                isFollowUp: true,
                rollMode: winner.rollMode || state.rollMode || "publicroll",
                rollerUserId: winner.rollerUserId || state.initiatorUserId || ""
            }
        ];
    }

    /** @override */
    async applyConsequences(state) {
        const targetParticipant = this.#getDamageTarget(state);
        const targetActor = this.#resolveActor(targetParticipant);
        if (!targetActor) return;

        if (state.hitWinnerKey === "defender" && state.defenderReaction === "maneuver") {
            const conditionKey = state.maneuverType === "knockdown" ? "prone" : "restrained";
            await CoC7DataMapper.setCondition(targetActor, conditionKey, true);
            return;
        }

        const finalDamage = Number(state.finalDamage ?? 0);
        if (finalDamage <= 0) return;

        const hpResource = CoC7DataMapper.getResource(targetActor, "hp") ?? {};
        const currentHp = Number(hpResource.value ?? 0);
        const maxHp = Number(hpResource.max ?? 10);
        const newHp = Math.max(0, currentHp - finalDamage);

        await targetActor.update({ "system.attribs.hp.value": newHp });

        if (finalDamage >= maxHp) {
            await CoC7DataMapper.setCondition(targetActor, "dead", true);
        } else if (newHp === 0) {
            await CoC7DataMapper.setCondition(targetActor, "unconscious", true);
            if (state.majorWoundTriggered) {
                await CoC7DataMapper.setCondition(targetActor, "dying", true);
            }
        } else if (state.majorWoundTriggered) {
            await CoC7DataMapper.setCondition(targetActor, "majorWound", true);
        }
    }

    /** @override */
    evaluateResolution(state) {
        if (state.combatPhase !== "resolution") {
            return { winnerKey: "", outcomeHeadline: "" };
        }

        const winner = state.participants?.find((p) => p.key === state.hitWinnerKey);
        const target = this.#getDamageTarget(state);
        const targetName = target?.actorName ?? game.i18n.localize("ROE_COC7.Combat.UnknownTarget");

        if (!winner) {
            return {
                winnerKey: "",
                outcomeHeadline: game.i18n.localize("ROE_COC7.Combat.OutcomeMissOrDodged")
            };
        }

        if (winner.key === "defender" && state.defenderReaction === "maneuver") {
            return {
                winnerKey: winner.key,
                outcomeHeadline: game.i18n.format("ROE_COC7.Combat.OutcomeManeuverSuccess", {
                    winner: winner.actorName,
                    target: targetName,
                    maneuver: game.i18n.localize(`ROE_COC7.Combat.Maneuvers.${state.maneuverType || "disarm"}`)
                })
            };
        }

        if (state.finalDamage !== null && state.finalDamage !== undefined) {
            return {
                winnerKey: winner.key,
                outcomeHeadline: game.i18n.format("ROE_COC7.Combat.OutcomeDamageSummary", {
                    winner: winner.actorName,
                    target: targetName,
                    damage: state.finalDamage
                })
            };
        }

        return {
            winnerKey: winner.key,
            outcomeHeadline: game.i18n.format("ROE_COC7.Combat.OutcomeHitPendingDamage", {
                winner: winner.actorName,
                target: targetName
            })
        };
    }

    _determineHitWinner(state) {
        const rank = BaseRollStrategy.LEVEL_RANK;
        const attacker = state.participants.find((p) => p.key === "attacker");
        const defender = state.participants.find((p) => p.key === "defender");
        if (!attacker) return "";

        const attRank = rank[attacker.successLevel] ?? 0;
        const reqRank = rank[state.difficulty] ?? rank.regular;

        if (!defender || state.defenderReaction === "none") {
            return attRank >= reqRank ? "attacker" : "";
        }

        const defRank = rank[defender.successLevel] ?? 0;
        const attPassed = attRank >= rank.regular;
        const defPassed = defRank >= rank.regular;

        if (state.defenderReaction === "dodge") {
            if (!attPassed) return "";
            if (!defPassed) return "attacker";
            return attRank > defRank ? "attacker" : "";
        }

        if (state.defenderReaction === "fightBack" || state.defenderReaction === "maneuver") {
            if (!attPassed && !defPassed) return "";
            if (attPassed && !defPassed) return "attacker";
            if (!attPassed && defPassed) return "defender";
            return attRank >= defRank ? "attacker" : "defender";
        }

        return "";
    }

    #getDamageTarget(state) {
        if (state.hitWinnerKey === "defender") {
            return state.participants?.find((p) => p.key === "attacker");
        }
        return state.participants?.find((p) => p.key === "defender");
    }

    #resolveWinnerWeapon(winnerActor, winner, state) {
        if (winner.key === "defender" && state.defenderWeaponId && state.defenderWeaponId !== "unarmed") {
            return winnerActor.items.get(state.defenderWeaponId) ?? null;
        }
        return winner.itemId ? winnerActor.items.get(winner.itemId) : null;
    }

    #resolveActor(participant) {
        if (!participant) return null;
        return SessionStore.resolveActor(participant);
    }
}
