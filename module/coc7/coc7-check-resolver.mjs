import { SessionStore } from "../core-bridge.mjs";

/** Implements percentile check resolution, roll construction, and pushed-roll validation. */
export class CoC7CheckResolver {
    static LEVEL_RANK = Object.freeze({
        fumble: 0,
        failure: 1,
        regular: 2,
        hard: 3,
        extreme: 4,
        critical: 5
    });

    /** Returns the CoC 7e success level for a roll against a target value. */
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

    /**
     * Builds a percentile formula; bonus or penalty dice add tens dice and keep the
     * lowest or highest tens result respectively.
     */
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

    /** Checks whether the session and selected participant are eligible for a push. */
    static canPush(state, participantKey) {
        if (!state || state.isResolved || state.isPreparingModifiers || state.canPush === false) return false;
        if (!["basic", "skill", "combined", "opposed"].includes(state.rollType)) return false;
        const participants = state.participants ?? [];
        const participant = participants.find((e) => e.key === participantKey);
        if (!participant?.hasRolled || participant.isPushed || participant.pushDecided || participant.canPush === false || participant.successLevel === "fumble") return false;
        const actor = SessionStore.resolveActor(participant);
        if (actor && actor.type !== "character") return false;

        if (state.rollType === "opposed") {
            if (participants.length < 2 || participants.some((e) => !e.hasRolled)) return false;
            return this.#determineOpposedWinnerKey(participants) !== participantKey;
        }

        if (state.rollType !== "combined") return !participant.isSuccess;
        if (participants.length < 2 || participants.some((e) => !e.hasRolled || e.isPushed || e.pushDecided || e.canPush === false || e.successLevel === "fumble")) return false;
        const passed = state.combinedMode === "or" ? participants.some((e) => e.isSuccess) : participants.every((e) => e.isSuccess);
        return !passed;
    }

    static #determineOpposedWinnerKey(participants) {
        const successful = participants.filter((p) => (this.LEVEL_RANK[p.successLevel] ?? 0) >= this.LEVEL_RANK.regular);
        if (successful.length === 0) return "";
        successful.sort((a, b) => {
            const rankDiff = (this.LEVEL_RANK[b.successLevel] ?? 0) - (this.LEVEL_RANK[a.successLevel] ?? 0);
            if (rankDiff !== 0) return rankDiff;
            return Number(b.targetValue ?? 0) - Number(a.targetValue ?? 0);
        });
        return successful[0].key;
    }

    /** Applies a validated pushed result to the participant or combined-check participants. */
    static buildPushedParticipants(state, participantKey, rollData) {
        if (!this.canPush(state, participantKey)) return null;
        const total = Number(rollData.total);
        if (!Number.isInteger(total) || total < 1 || total > 100) return null;
        const targets = state.rollType === "combined" ? state.participants : state.participants.filter((e) => e.key === participantKey);
        const modifierDice = Number(targets[0]?.modifierDice ?? 0);
        if (Number(rollData.modifierDice ?? 0) !== modifierDice) return null;

        const keys = new Set(targets.map((e) => e.key));
        const requiredRank = this.LEVEL_RANK[state.difficulty] ?? 2;

        const participants = state.participants.map((p) => {
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
                pushFailed: undefined,
                luckDecided: true,
                rollMode: rollData.rollMode || state.rollMode || "publicroll",
                rollerUserId: rollData.rollerUserId || "",
                rollBreakdown: { ...rollData.rollBreakdown, total, targetValue: target, successLevel, modifierDice }
            };
        });
        const pushFailed = this.didPushFail({ ...state, participants }, participantKey);
        return participants.map((participant) =>
            keys.has(participant.key) ? { ...participant, pushFailed } : participant
        );
    }

    /** Reports whether a pushed check failed, including combined and opposed outcomes. */
    static didPushFail(state, participantKey) {
        const participants = state?.participants ?? [];
        const participant = participants.find((entry) => entry.key === participantKey);
        if (!participant?.hasRolled || !participant.isPushed) return false;
        if (typeof participant.pushFailed === "boolean") return participant.pushFailed;
        if (state.rollType === "combined") {
            if (!participants.length || participants.some((entry) => !entry.hasRolled || !entry.isPushed)) return false;
            const passed = state.combinedMode === "or"
                ? participants.some((entry) => entry.isSuccess)
                : participants.every((entry) => entry.isSuccess);
            return !passed;
        }
        if (state.rollType === "opposed") {
            if (participants.length < 2 || participants.some((entry) => !entry.hasRolled)) return false;
            return this.#determineOpposedWinnerKey(participants) !== participantKey;
        }
        return !participant.isSuccess;
    }
}
