import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy } from "../../core-bridge.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CombatDamageDecision } from "../strategies/combat-damage-decision.mjs";

/**
 * Rolls pending damage for melee or multi-hit ranged attacks and submits the result.
 */
export class DamageRollSubmitter {
    /** Rolls and submits one pending damage participant, including its ranged hits. */
    static async submit(messageId, participantKey = "damage") {
        const sys = SessionStore.getSession(game.messages.get(messageId));
        const damageEntry = sys?.participants?.find((p) => p.key === participantKey);
        if (!damageEntry || damageEntry.hasRolled || sys.isResolved || CombatDamageDecision.pendingKey(sys)) return;

        if (sys.rollType === "ranged" && Array.isArray(sys.rangedHits) && sys.rangedHits.length > 0) {
            const hitResults = [];
            let totalRaw = 0;
            let lastBreakdown = null;

            const hits = damageEntry.shotNumber
                ? sys.rangedHits.filter((hit) => hit.shotNumber === damageEntry.shotNumber)
                : damageEntry.targetKey
                    ? sys.rangedHits.filter((hit) => hit.targetKey === damageEntry.targetKey) : sys.rangedHits;
            for (const hit of hits) {
                const formula = hit.formula || damageEntry.diceFormula || "1d6";
                const roll = await new Roll(formula).evaluate(hit.impale ? { maximize: true } : {});
                const val = Math.max(0, Number(roll.total ?? 0));
                totalRaw += val;
                hitResults.push({ ...hit, rawDamage: val });
                lastBreakdown = CoC7CheckResolver.buildBreakdown(roll, 0, "");
            }

            await UniversalRollOrchestrator.submitParticipantRoll(messageId, participantKey, {
                total: totalRaw,
                successLevel: "regular",
                isSuccess: true,
                modifierDice: 0,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id,
                rollBreakdown: lastBreakdown,
                rangedHitResults: hitResults
            });
            return;
        }

        const roll = await this.#evaluateDamage(sys, damageEntry);
        await UniversalRollOrchestrator.submitParticipantRoll(messageId, participantKey, {
            total: Math.max(0, roll.total),
            successLevel: "regular",
            isSuccess: true,
            modifierDice: 0,
            rollMode: RollVisibilityPolicy.getCurrentRollMode(),
            rollerUserId: game.user.id,
            rollBreakdown: CoC7CheckResolver.buildBreakdown(roll, 0, "")
        });
    }

    static async #evaluateDamage(sys, damageEntry) {
        const winner = sys.participants?.find((p) => p.key === sys.hitWinnerKey);
        const isExtremeOrCrit = winner?.successLevel === "extreme" || winner?.successLevel === "critical";
        const winnerActor = winner ? SessionStore.resolveActor(winner) : null;
        const weapon = this.#resolveWinnerWeapon(winnerActor, winner, sys);
        const isImpale = isExtremeOrCrit && Boolean(weapon?.system?.properties?.impl);

        if (isImpale) {
            const baseWeaponFormula = weapon?.system?.range?.normal?.damage || sys.damageFormula || "1d6";
            const maxBaseRoll = await new Roll(baseWeaponFormula).evaluate({ maximize: true });
            const extraDiceRoll = await new Roll(baseWeaponFormula).evaluate();
            const isMelee = sys.combatType === "melee" || winner?.key === "defender";
            const rawBonus = isMelee ? (sys.damageBonus || "0") : "0";
            const bonusRoll = rawBonus && rawBonus !== "0"
                ? await new Roll(rawBonus).evaluate({ maximize: true })
                : { total: 0, terms: [] };

            const total = Math.max(0, Number(maxBaseRoll.total ?? 0) + Number(extraDiceRoll.total ?? 0) + Number(bonusRoll.total ?? 0));
            return {
                formula: damageEntry.diceFormula || `${baseWeaponFormula}+${baseWeaponFormula}`,
                total,
                terms: [...(maxBaseRoll.terms ?? []), ...(extraDiceRoll.terms ?? []), ...(bonusRoll.terms ?? [])]
            };
        }

        const roll = new Roll(damageEntry.diceFormula || "1d6");
        return roll.evaluate(isExtremeOrCrit ? { maximize: true } : {});
    }

    static #resolveWinnerWeapon(winnerActor, winner, sys) {
        if (!winnerActor || !winner) return null;
        if (winner.key === "defender" && sys.defenderWeaponId && sys.defenderWeaponId !== "unarmed") {
            return winnerActor.items?.get?.(sys.defenderWeaponId) ?? null;
        }
        return winner.itemId ? winnerActor.items?.get?.(winner.itemId) ?? null : null;
    }
}
