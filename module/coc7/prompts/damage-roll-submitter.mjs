import { SessionStore } from "../../core-bridge.mjs";
import { UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { RollVisibilityPolicy } from "../../core-bridge.mjs";

/**
 * Rolls the pending damage participant of a combat or ranged session and submits the result.
 */
export class DamageRollSubmitter {
    static async submit(messageId) {
        const sys = SessionStore.getSession(game.messages.get(messageId));
        const damageEntry = sys?.participants?.find((p) => p.key === "damage");
        if (!damageEntry || damageEntry.hasRolled || sys.isResolved) return;

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
