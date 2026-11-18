import { MODULE_ID, SessionStore } from "../../core-bridge.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { CombatConsequenceApplier } from "./combat-consequence-applier.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { RangedCombatRules } from "../ranged/ranged-combat-rules.mjs";
import { RangedWeaponService } from "../ranged/ranged-weapon-service.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";

/**
 * Standalone strategy for Call of Cthulhu 7e ranged combat:
 * target cover reaction, shot/burst/full-auto sequence, and per-bullet damage resolution.
 */
export class RangedRollStrategy extends BaseRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("ranged"))(options).render(true);
    }

    /** Applies a ranged roll, advances the attack, and prepares any damage follow-ups. */
    async onRollApplied(participant, state) {
        if (!participant?.hasRolled || participant.isShotDetail) return [];

        if (participant.key === "defender") {
            state.combatPhase = "attack";
            return [];
        }

        if (participant.key === "attacker") {
            if (state.rangedFireMode === "auto") return this.#applyVolley(participant, state);
            state.combatPhase = "resolution";
            const followUps = this.advanceToResolution(state);
            this.#flagPendingCoverConsequence(state);
            return followUps;
        }

        if (participant.key === "damage" || participant.key.startsWith("damage_")) {
            await this.#resolveDamageOutcome(state, participant);
            this.#flagPendingCoverConsequence(state);
            return [];
        }

        return [];
    }

    async #applyVolley(attacker, state) {
        const actor = SessionStore.resolveActor(attacker);
        const weapon = actor?.items?.get?.(state.weaponId || attacker.itemId);
        if (!weapon) throw new Error("Cannot fire a volley without the ranged weapon.");
        const profile = RangedWeaponService.getWeaponCombatProfile(weapon, attacker.targetValue);
        const roundsFired = profile.tracksAmmo ? Math.min(profile.autoVolleySize, profile.ammo) : profile.autoVolleySize;
        if (roundsFired < 3) throw new Error("At least three rounds are required to fire a volley.");
        const target = state.participants.find((entry) => entry.key === "defender");
        const modifier = RangedCombatRules.computeModifierDice(state, attacker);
        const difficulty = RangedCombatRules.computeRequiredDifficulty(state, modifier);
        const malfunction = Number(attacker.total) >= profile.malfunctionThreshold;
        attacker.successLevel = CoC7CheckResolver.evaluateResult(Number(attacker.total), Number(attacker.targetValue));
        const isHit = !malfunction && (CoC7CheckResolver.LEVEL_RANK[attacker.successLevel] ?? 0)
            >= (CoC7CheckResolver.LEVEL_RANK[difficulty] ?? 2);
        attacker.isSuccess = isHit;
        const { hits, impales } = RangedCombatRules.computeHitsForShot({
            isHit, successLevel: attacker.successLevel, fireMode: "auto",
            bulletsNeeded: roundsFired, isImpalingWeapon: profile.isImpaling
        });
        const remainingAmmo = await RangedWeaponService.consumeWeaponAmmo(weapon, roundsFired);
        if (malfunction) await RangedWeaponService.setWeaponMalfunction(weapon, true);
        this.#recordVolley(state, attacker, target, profile, { roundsFired, hits, impales, isHit, malfunction });
        state.remainingAmmo = remainingAmmo;
        state.weaponProfile = { ...profile, ammo: remainingAmmo, isJammed: malfunction };
        state.rangedMalfunction = malfunction;
        if (!malfunction && (remainingAmmo === null || remainingAmmo >= 3)) {
            attacker.hasRolled = false;
            return [];
        }
        state.autoFireEnded = true;
        return this.advanceToResolution(state);
    }

    #recordVolley(state, attacker, target, profile, result) {
        const number = Number(state.volleyCount ?? 0) + 1;
        const targetKey = state.rangedTargetTokenId || target?.actorUuid || target?.actorId || "";
        const shot = {
            index: number, fireMode: "auto", targetKey, targetActorId: target?.actorId ?? "",
            targetActorUuid: target?.actorUuid ?? "", targetName: target?.actorName ?? "",
            total: attacker.total, successLevel: attacker.successLevel, isHit: result.isHit,
            malfunction: result.malfunction, bulletsSpent: result.roundsFired, hits: result.hits,
            impales: result.impales, modifierDice: attacker.rollBreakdown?.modifierDice ?? 0,
            rollBreakdown: attacker.rollBreakdown
        };
        state.volleyLog = [...(state.volleyLog ?? []), {
            volleyNumber: number, targetKey, targetName: shot.targetName, total: attacker.total,
            targetValue: attacker.targetValue, successLevel: attacker.successLevel, isHit: result.isHit,
            isImpale: result.impales > 0, roundsFired: result.roundsFired, roundsHit: result.hits
        }];
        state.rangedShots = [...(state.rangedShots ?? []), shot];
        state.rangedHits = [...(state.rangedHits ?? []), ...this.#buildVolleyHits(state, shot, profile)];
        state.participants.push({ ...attacker, key: `shot_${number}`, hasRolled: true, isShotDetail: true });
        state.volleyCount = number;
        state.rangedVolleyIndex = number;
        state.rangedShotsFired = Number(state.rangedShotsFired ?? 0) + 1;
        state.rangedBulletsSpent = Number(state.rangedBulletsSpent ?? 0) + result.roundsFired;
        state.lastVolleyTargetTokenId = state.rangedTargetTokenId;
        state.traversePenaltyDice = 0;
        state.traverseDistance = 0;
    }

    #buildVolleyHits(state, shot, profile) {
        const hits = [];
        const formula = RangedCombatRules.resolveRangeDamageFormula(state, profile);
        for (let index = 0; index < shot.hits; index++) {
            hits.push({
                targetKey: shot.targetKey, targetActorId: shot.targetActorId,
                targetActorUuid: shot.targetActorUuid, targetName: shot.targetName,
                impale: index < shot.impales, formula
            });
        }
        return hits;
    }

    /** Ends a ranged attack and creates pending damage rolls for its hit targets. */
    advanceToResolution(state) {
        state.combatPhase = "resolution";
        this.#flagPendingCoverConsequence(state);
        const hitWinnerKey = this.#determineHitWinner(state);
        state.hitWinnerKey = hitWinnerKey;

        const alreadyHasDamage = state.participants?.some((p) => p.key === "damage");
        if (!hitWinnerKey || alreadyHasDamage) return [];

        const winner = state.participants.find((p) => p.key === hitWinnerKey);
        const winnerActor = SessionStore.resolveActor(winner);
        if (!winner || !winnerActor) throw new Error("Cannot resolve the attacker for ranged damage.");

        const hits = Array.isArray(state.rangedHits) ? state.rangedHits : [];
        if (state.rangedFireMode === "auto" && hits.length) {
            return this.#buildTargetDamageParticipants(state, winner, winnerActor, hits);
        }
        const hitCount = Math.max(1, hits.length);
        const impaleCount = hits.filter((h) => h.impale).length;
        const baseFormula = hits[0]?.formula || state.damageFormula || "1d6";
        const displayFormula = hitCount > 1 ? `${hitCount}× (${baseFormula})` : baseFormula;

        const damageLabel = impaleCount > 0
            ? `${game.i18n.localize("ROE_COC7.Combat.DamageRoll")} (${game.i18n.localize("ROE_COC7.Combat.ImpalingExtreme")})`
            : game.i18n.localize("ROE_COC7.Combat.DamageRoll");

        return [
            {
                ...SessionStore.buildParticipant("damage", winnerActor, damageLabel, 0),
                diceFormula: displayFormula,
                isFollowUp: true,
                rollMode: winner.rollMode || state.rollMode || "publicroll",
                rollerUserId: winner.rollerUserId || state.initiatorUserId || ""
            }
        ];
    }

    #buildTargetDamageParticipants(state, winner, winnerActor, hits) {
        const groups = new Map();
        for (const hit of hits) {
            const key = hit.targetKey || hit.targetActorUuid || hit.targetActorId;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(hit);
        }
        return Array.from(groups.entries(), ([targetKey, targetHits], index) =>
            this.#buildTargetDamageParticipant(state, winner, winnerActor, targetKey, targetHits, index)
        );
    }

    #buildTargetDamageParticipant(state, winner, winnerActor, targetKey, hits, index) {
        const formula = hits[0].formula || state.damageFormula || "1d6";
        const label = `${game.i18n.localize("ROE_COC7.Combat.DamageRoll")} (${hits[0].targetName})`;
        return {
            ...SessionStore.buildParticipant(index === 0 ? "damage" : `damage_${index}`, winnerActor, label, 0),
            targetKey, targetActorId: hits[0].targetActorId, targetActorUuid: hits[0].targetActorUuid,
            diceFormula: hits.length > 1 ? `${hits.length}× (${formula})` : formula,
            isFollowUp: true, rollMode: winner.rollMode || state.rollMode || "publicroll",
            rollerUserId: winner.rollerUserId || state.initiatorUserId || ""
        };
    }
    async #resolveDamageOutcome(state, damageParticipant) {
        const defaultTarget = state.participants?.find((p) => p.key === "defender");
        const defaultActor = SessionStore.resolveActor(defaultTarget);
        const hitResults = Array.isArray(state.rangedHitResults) && state.rangedHitResults.length > 0
            ? state.rangedHitResults
            : [{ targetActorId: defaultActor?.id ?? "", rawDamage: Number(damageParticipant.total ?? 0), impale: false }];

        const summary = RangedCombatRules.evaluateMultiHitDamage(hitResults, defaultActor);
        state.rawDamage = summary.rawDamage;
        state.armorApplied = summary.armorApplied;
        state.finalDamage = summary.finalDamage;
        state.majorWoundTriggered = summary.majorWoundTriggered;
        state.rangedDamageByActor = summary.damageByActor;
        state.hasPendingConsequences = (summary.finalDamage > 0 || this.#targetTookCover(state)) && !state.consequencesApplied;

        const allDamageRolled = state.participants.filter((p) => p.key === "damage" || p.key.startsWith("damage_"))
            .every((p) => p.hasRolled);
        const autoApply = allDamageRolled && Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
        if (state.hasPendingConsequences && autoApply) {
            await this.applyConsequences(state);
            state.consequencesApplied = true;
            state.hasPendingConsequences = false;
        }
    }

    #determineHitWinner(state) {
        if (Array.isArray(state.rangedHits) && state.rangedHits.length > 0) return "attacker";
        if (state.rangedMalfunction || state.rangedFireMode === "auto") return "";
        const rank = BaseRollStrategy.LEVEL_RANK;
        const attacker = state.participants.find((p) => p.key === "attacker");
        const requiredRank = rank[state.difficulty] ?? rank.regular;
        return (rank[attacker?.successLevel] ?? 0) >= requiredRank ? "attacker" : "";
    }

    /** Applies recorded ranged damage and cover consequences to the affected actors. */
    async applyConsequences(state) {
        for (const [actorId, info] of Object.entries(state.rangedDamageByActor ?? {})) {
            const targetActor = SessionStore.resolveActor({ actorUuid: info.actorUuid, actorId: info.actorId || actorId });
            await CombatConsequenceApplier.applyDamageToActor(targetActor, info?.damage, Boolean(info?.majorWound));
        }

        const targets = [...(state.rangedCoverTargets ?? [])];
        const defender = state.participants?.find((p) => p.key === "defender");
        if (defender?.tookCover) targets.push(defender);
        for (const target of targets) {
            const targetActor = SessionStore.resolveActor(target);
            if (targetActor) await CoC7DataMapper.setCondition(targetActor, "prone", true);
        }
    }

    #targetTookCover(state) {
        return Boolean(state.rangedCoverTargets?.length || state.participants?.find((p) => p.key === "defender")?.tookCover);
    }

    #flagPendingCoverConsequence(state) {
        if (this.#targetTookCover(state) && !state.consequencesApplied) {
            state.hasPendingConsequences = true;
        }
    }
}
