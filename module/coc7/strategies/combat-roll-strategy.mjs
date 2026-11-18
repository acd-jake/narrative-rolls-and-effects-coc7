import { MODULE_ID } from "../../core-bridge.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { SessionStore } from "../../core-bridge.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { CombatConsequenceApplier } from "./combat-consequence-applier.mjs";

/** Resolves melee exchanges, creates damage follow-ups, and applies combat consequences. */
export class CombatRollStrategy extends BaseRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("combat"))(options).render(true);
    }

    /** Processes melee checks and prepares damage for a GM decision or automatic application. */
    async onRollApplied(participant, state) {
        if (!participant?.hasRolled) return [];

        // PHASE 3B: Damage roll completed -> compute armor mitigation & HP deduction
        if (participant.key === "damage") {
            const targetParticipant = CombatRollStrategy.getDamageTarget(state);
            const targetActor = this.#resolveActor(targetParticipant);
            const armor = Number(CoC7DataMapper.getCombatValue(targetActor, "armor") ?? targetActor?.system?.armor?.value ?? 0);
            const rawDamage = Math.max(0, Number(participant.total ?? 0));
            const finalDamage = Math.max(0, rawDamage - armor);

            const maxHp = Number(CoC7DataMapper.getResource(targetActor, "hp")?.max ?? 10);
            // Major wounds are measured against maximum HP, after armor mitigation.
            const majorWoundTriggered = finalDamage > 0 && finalDamage >= Math.ceil(maxHp / 2);

            state.rawDamage = rawDamage;
            state.armorApplied = armor;
            state.finalDamage = finalDamage;
            state.majorWoundTriggered = majorWoundTriggered;
            state.pendingDamageKey = participant.key;
            state.hasPendingConsequences = true;
            state.consequencesApplied = false;

            const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
            if (autoApply) await this.#completeDamageDecision(state, "apply");
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

    /** Applies or discards the pending melee damage without revealing the decision. */
    async decideDamageConsequences(session, action) {
        const state = { ...session };
        await this.#completeDamageDecision(state, action);
        return state;
    }

    async #completeDamageDecision(state, action) {
        if (action === "apply") await this.applyConsequences(state);
        state.pendingDamageKey = "";
        state.hasPendingConsequences = false;
        state.consequencesApplied = true;
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
        const targetParticipant = CombatRollStrategy.getDamageTarget(state);
        const targetActor = this.#resolveActor(targetParticipant);
        if (!targetActor) throw new Error("Cannot apply combat consequences without a target actor.");

        if (state.hitWinnerKey === "defender" && state.defenderReaction === "maneuver") {
            const conditionByManeuver = {
                grapple: "restrained",
                knockdown: "prone"
            };
            const conditionKey = conditionByManeuver[state.maneuverType];
            if (conditionKey) await CoC7DataMapper.setCondition(targetActor, conditionKey, true);
            return;
        }

        const finalDamage = Number(state.finalDamage ?? 0);
        if (finalDamage <= 0) return;

        await CombatConsequenceApplier.applyDamageToActor(
            targetActor,
            finalDamage,
            Boolean(state.majorWoundTriggered)
        );
    }

    /** @override */
    evaluateResolution(state) {
        if (state.combatPhase !== "resolution") {
            return { winnerKey: "", outcomeHeadline: "" };
        }

        const winner = state.participants?.find((p) => p.key === state.hitWinnerKey);
        const target = CombatRollStrategy.getDamageTarget(state);
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
        const attPassed = attRank >= reqRank;
        const defPassed = defRank >= rank.regular;

        // A dodge avoids a hit on an equal success level; fighting back favors the attacker on ties.
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

    /** Returns the combatant who receives damage or other consequences from the winner. */
    static getDamageTarget(state) {
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
