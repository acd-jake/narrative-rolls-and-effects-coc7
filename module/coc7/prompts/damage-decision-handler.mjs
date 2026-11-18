import { SessionStore, UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { CombatDamageDecision } from "../strategies/combat-damage-decision.mjs";

/** Submits GM-only decisions for pending combat damage. */
export class DamageDecisionHandler {
    /** Applies or declines the pending damage roll for the current session. */
    static async submit(messageId, action) {
        if (!game.user.isGM) throw new Error("Only a GM can decide damage consequences.");
        if (!["apply", "decline"].includes(action)) throw new Error("Invalid damage consequence decision.");
        const session = SessionStore.getSession(game.messages.get(messageId));
        const participantKey = CombatDamageDecision.pendingKey(session);
        if (!participantKey || session.isResolved) return;
        if (typeof UniversalRollOrchestrator.submitConsequenceDecision !== "function") {
            globalThis.ui?.notifications?.error(game.i18n.localize("ROE_COC7.Combat.DamageDecisionUnavailable"));
            throw new Error("The Narrative Rolls core module must support GM consequence decisions.");
        }
        await UniversalRollOrchestrator.submitConsequenceDecision(messageId, {
            action, participantKey
        });
    }
}
