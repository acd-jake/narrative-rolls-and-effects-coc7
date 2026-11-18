/** Identifies outstanding combat damage decisions, including older saved sessions. */
export class CombatDamageDecision {
    /** Returns the pending damage participant key, or an empty string when no decision is needed. */
    static pendingKey(session) {
        if (session?.isResolved) return "";
        if (session?.pendingDamageKey) return session.pendingDamageKey;
        if (!session?.hasPendingConsequences || session.consequencesApplied || session.rangedDamageDecisionStarted) return "";
        if (session.rollType === "combat" && session.finalDamage == null) return "";
        if (session.rollType === "ranged" && !Object.keys(session.rangedDamageByActor ?? {}).length) return "";
        if (!["combat", "ranged"].includes(session.rollType)) return "";
        const damage = (session.participants ?? []).filter((entry) =>
            entry.hasRolled && (entry.key === "damage" || entry.key.startsWith("damage_"))
        );
        return damage[damage.length - 1]?.key ?? "";
    }
}
