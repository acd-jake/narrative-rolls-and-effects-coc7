import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/** Stateless Call of Cthulhu 7e ranged combat rule calculations. */
export class RangedCombatRules {
    /** Computes effective CoC 7e ranged modifier dice from tactical flags, cover, and fire mode. */
    static computeModifierDice(session, attacker, { fireMode = null, shotIndex = null, volleyIndex = null } = {}) {
        const flags = session.tacticalFlags ?? {};
        const tookCover = Boolean(session.participants?.find((entry) => entry.key === "defender")?.tookCover);
        const mode = fireMode ?? session.rangedFireMode ?? "single";
        const shotNo = shotIndex ?? Number(session.rangedShotsFired ?? 0);
        const volleyNo = volleyIndex ?? Number(session.rangedVolleyIndex ?? 0);

        let mod = Number(attacker?.modifierDice ?? 0);
        if (flags.pointBlank) mod += 1;
        if (flags.aiming) mod += 1;
        if (flags.largeTarget) mod += 1;
        if (flags.cover) mod -= 1;
        if (flags.fastTarget) mod -= 1;
        if (flags.inMelee) mod -= 1;
        if (flags.proneTarget) mod -= 1;
        if (flags.smallTarget) mod -= 1;
        if (tookCover) mod -= 1;

        if (mode === "multiple" && shotNo >= 1) mod -= 1;
        if (mode === "auto" && volleyNo >= 1) mod -= volleyNo;

        return mod;
    }

    /** Computes required difficulty rank for ranged attacks including range tier and auto-fire overflow. */
    static computeRequiredDifficulty(session, rawModifierDice) {
        const tierOrder = ["regular", "hard", "extreme"];
        const baseTier = session.rangedRangeTier === "extreme"
            ? "extreme"
            : session.rangedRangeTier === "long"
                ? "hard"
                : session.difficulty || "regular";
        let idx = Math.max(0, tierOrder.indexOf(baseTier));
        if (rawModifierDice < -2) {
            idx = Math.min(2, idx + Math.abs(rawModifierDice + 2));
        }
        return tierOrder[idx];
    }

    /** Returns rounds consumed by the next shot/volley for the active fire mode. */
    static getBulletsForNextAction(fireMode, profile) {
        if (fireMode === "burst") return Math.max(2, profile.burstSize || 3);
        if (fireMode === "auto") return Math.max(3, profile.autoVolleySize || 3);
        return 1;
    }

    /** Returns remaining firing actions in the current combat round. */
    static getRemainingRoundCapacity(session, profile) {
        const reloadPenalty = session.rangedReloadedInRound ? 1 : 0;
        const fired = Number(session.rangedShotsFired ?? 0);
        const mode = session.rangedFireMode || "single";
        const maxActions = mode === "multiple" || mode === "auto" ? profile.maxUses : 1;
        return Math.max(0, maxActions - fired - reloadPenalty);
    }
    /** Calculates hit count and impaling hits for a single shot, burst, or full-auto volley. */
    static computeHitsForShot({ isHit, successLevel, fireMode, bulletsNeeded, isImpalingWeapon }) {
        if (!isHit) return { hits: 0, impales: 0 };
        const isExtremeOrCrit = successLevel === "extreme" || successLevel === "critical";

        if (fireMode === "burst" || fireMode === "auto") {
            if (isExtremeOrCrit) {
                const hits = bulletsNeeded;
                const impales = isImpalingWeapon ? Math.max(1, Math.floor(hits / 2)) : 0;
                return { hits, impales };
            }
            const hits = Math.max(1, Math.floor(bulletsNeeded / 2));
            return { hits, impales: 0 };
        }

        return {
            hits: 1,
            impales: isExtremeOrCrit && isImpalingWeapon ? 1 : 0
        };
    }

    /** Resolves damage formula for the active range tier. */
    static resolveRangeDamageFormula(session, profile) {
        if (session.rangedRangeTier === "extreme") return profile.extremeDamage || session.damageFormula;
        if (session.rangedRangeTier === "long") return profile.longDamage || session.damageFormula;
        return profile.normalDamage || session.damageFormula;
    }

    /** Returns the highest success level achieved across all fired shots/volleys. */
    static resolveBestShotSuccessLevel(shots) {
        const rank = CoC7CheckResolver.LEVEL_RANK;
        let best = "failure";
        for (const s of shots ?? []) {
            if (s.isTargetSwitch) continue;
            if ((rank[s.successLevel] ?? 0) > (rank[best] ?? 0)) best = s.successLevel;
        }
        return best;
    }

    /** Evaluates per-bullet armor mitigation and major wound triggers across multi-hit results. */
    static evaluateMultiHitDamage(hitResults, defaultTargetActor) {
        const damageByActor = new Map();
        let totalRaw = 0;
        let totalArmor = 0;
        let totalFinal = 0;
        let majorWoundTriggered = false;

        for (const hit of hitResults) {
            const actor = (hit.targetActorId ? game.actors?.get?.(hit.targetActorId) : null) ?? defaultTargetActor;
            const armor = Number(CoC7DataMapper.getCombatValue(actor, "armor") ?? actor?.system?.armor?.value ?? 0);
            const raw = Math.max(0, Number(hit.rawDamage ?? 0));
            const final = Math.max(0, raw - armor);
            const maxHp = Number(CoC7DataMapper.getResource(actor, "hp")?.max ?? 10);

            totalRaw += raw;
            totalArmor += armor;
            totalFinal += final;
            if (final > 0 && final >= Math.ceil(maxHp / 2)) majorWoundTriggered = true;

            if (actor?.id) {
                const prev = damageByActor.get(actor.id) ?? { damage: 0, majorWound: false };
                damageByActor.set(actor.id, {
                    damage: prev.damage + final,
                    majorWound: prev.majorWound || (final > 0 && final >= Math.ceil(maxHp / 2))
                });
            }
        }

        return {
            rawDamage: totalRaw,
            armorApplied: totalArmor,
            finalDamage: totalFinal,
            majorWoundTriggered,
            damageByActor: Object.fromEntries(damageByActor.entries())
        };
    }
}
