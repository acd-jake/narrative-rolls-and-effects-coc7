import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy } from "../../core-bridge.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

/**
 * Rolls pending damage for melee or multi-hit ranged attacks and submits the result.
 */
export class DamageRollSubmitter {
    static async submit(messageId) {
        const sys = SessionStore.getSession(game.messages.get(messageId));
        const damageEntry = sys?.participants?.find((p) => p.key === "damage");
        if (!damageEntry || damageEntry.hasRolled || sys.isResolved) return;

        if (sys.rollType === "ranged" && Array.isArray(sys.rangedHits) && sys.rangedHits.length > 0) {
            const hitResults = [];
            let totalRaw = 0;
            let lastBreakdown = null;

            for (const hit of sys.rangedHits) {
                const formula = hit.formula || damageEntry.diceFormula || "1d6";
                const roll = await new Roll(formula).evaluate(hit.impale ? { maximize: true } : {});
                const val = Math.max(0, Number(roll.total ?? 0));
                totalRaw += val;
                hitResults.push({ ...hit, rawDamage: val });
                lastBreakdown = CoC7CheckResolver.buildBreakdown(roll, 0, "");
            }

            await UniversalRollOrchestrator.updateSessionPatch(messageId, { rangedHitResults: hitResults });
            await UniversalRollOrchestrator.submitParticipantRoll(messageId, "damage", {
                total: totalRaw,
                successLevel: "regular",
                isSuccess: true,
                modifierDice: 0,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id,
                rollBreakdown: lastBreakdown
            });
            return;
        }

        const roll = await this.#evaluateDamage(sys, damageEntry);
        await UniversalRollOrchestrator.submitParticipantRoll(messageId, "damage", {
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
        const maximize = winner?.successLevel === "extreme" || winner?.successLevel === "critical";
        const roll = new Roll(damageEntry.diceFormula || "1d6");
        return roll.evaluate(maximize ? { maximize: true } : {});
    }
}
