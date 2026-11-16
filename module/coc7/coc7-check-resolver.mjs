export class CoC7CheckResolver {
    static LEVEL_RANK = Object.freeze({
        fumble: 0,
        failure: 1,
        regular: 2,
        hard: 3,
        extreme: 4,
        critical: 5
    });

    static evaluateResult(rollTotal, targetValue) {
        if (rollTotal === 1) return "critical";
        targetValue = Number(targetValue);
        const fumbleThreshold = targetValue < 50 ? 96 : 100;
        if (rollTotal >= fumbleThreshold) return "fumble";
        if (rollTotal <= Math.floor(targetValue / 5)) return "extreme";
        if (rollTotal <= Math.floor(targetValue / 2)) return "hard";
        if (rollTotal <= targetValue) return "regular";
        return "failure";
    }

    static buildRollFormula(modifierDice = 0) {
        const extraTens = Math.abs(modifierDice);
        if (extraTens === 0) return "1d100";
        const tensKeep = modifierDice > 0 ? "kl" : "kh";
        return `((${1 + extraTens}d10${tensKeep} - 1) * 10) + (1d10 - 1)`;
    }

    static buildBreakdown(roll, targetValue = 0, successLevel = "", modifiers = null) {
        const diceTerms = [];
        for (const term of roll.terms ?? []) {
            if (term instanceof foundry.dice.terms.Die) {
                diceTerms.push({
                    expression: `${term.number}d${term.faces}`,
                    results: (term.results ?? []).map((r) => ({ value: r.result, active: r.active !== false && !r.discarded }))
                });
            }
        }
        const target = Number(targetValue ?? 0);
        return {
            formula: roll.formula,
            total: roll.total === 0 && roll.formula.includes("100") ? 100 : roll.total,
            targetValue: target,
            hardThreshold: target > 0 ? Math.floor(target / 2) : 0,
            extremeThreshold: target > 0 ? Math.floor(target / 5) : 0,
            successLevel,
            ...(modifiers ? { modifierDice: Number(modifiers.modifierDice ?? 0), tacticalFlags: modifiers.tacticalFlags ?? [] } : {}),
            diceTerms
        };
    }

    static canPush(state, participantKey) {
        if (!state || state.isResolved || state.isPreparingModifiers || state.canPush === false) return false;
        if (!["basic", "skill", "combined"].includes(state.rollType)) return false;
        const participants = state.participants ?? [];
        const participant = participants.find((e) => e.key === participantKey);
        if (!participant?.hasRolled || participant.isPushed || participant.successLevel === "fumble") return false;
        if (state.rollType !== "combined") return !participant.isSuccess;
        if (participants.length < 2 || participants.some((e) => !e.hasRolled || e.isPushed || e.successLevel === "fumble")) return false;
        const passed = state.combinedMode === "or" ? participants.some((e) => e.isSuccess) : participants.every((e) => e.isSuccess);
        return !passed;
    }

    static buildPushedParticipants(state, participantKey, rollData) {
        if (!this.canPush(state, participantKey)) return null;
        const total = Number(rollData.total);
        if (!Number.isInteger(total) || total < 1 || total > 100) return null;
        const targets = state.rollType === "combined" ? state.participants : state.participants.filter((e) => e.key === participantKey);
        const modifierDice = Number(targets[0]?.modifierDice ?? 0);
        if (Number(rollData.modifierDice ?? 0) !== modifierDice) return null;

        const keys = new Set(targets.map((e) => e.key));
        const requiredRank = this.LEVEL_RANK[state.difficulty] ?? 2;

        return state.participants.map((p) => {
            if (!keys.has(p.key)) return p;
            const target = Number(p.targetValue ?? 0);
            const successLevel = this.evaluateResult(total, target);
            return {
                ...p,
                previousRoll: { total: p.total, successLevel: p.successLevel, isSuccess: p.isSuccess, rollBreakdown: p.rollBreakdown ?? null },
                total,
                successLevel,
                isSuccess: (this.LEVEL_RANK[successLevel] ?? 0) >= requiredRank,
                isPushed: true,
                luckDecided: true,
                rollMode: rollData.rollMode || state.rollMode || "publicroll",
                rollerUserId: rollData.rollerUserId || "",
                rollBreakdown: { ...rollData.rollBreakdown, total, targetValue: target, successLevel, modifierDice }
            };
        });
    }
}
