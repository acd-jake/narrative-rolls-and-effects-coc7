import { MODULE_ID, SessionStore } from "../../core-bridge.mjs";
import { BaseRollStrategy } from "./base-roll-strategy.mjs";
import { CombatConsequenceApplier } from "./combat-consequence-applier.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { RangedCombatRules } from "../ranged/ranged-combat-rules.mjs";
import { RangedDamageState } from "../ranged/ranged-damage-state.mjs";
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
            return this.#applyShot(participant, state);
        }

        if (participant.key === "damage" || participant.key.startsWith("damage_")) {
            if (Array.isArray(participant.rangedHitResults)) {
                state.rangedHitResults = [...(state.rangedHitResults ?? []), ...participant.rangedHitResults];
            }
            await this.#resolveDamageOutcome(state, participant);
            if (game.settings?.get(MODULE_ID, "autoApplyRollConsequences")) {
                await this.#completeDamageDecision(state, "apply");
            }
            return [];
        }

        return [];
    }

    async #applyShot(attacker, state) {
        const actor = SessionStore.resolveActor(attacker);
        const weapon = actor?.items?.get?.(state.weaponId || attacker.itemId);
        if (!weapon) throw new Error("Cannot fire without the ranged weapon.");
        const profile = RangedWeaponService.getWeaponCombatProfile(weapon, attacker.targetValue);
        const mode = state.rangedFireMode || "single";
        const needed = RangedCombatRules.getBulletsForNextAction(mode, profile);
        const roundsFired = mode === "auto" && profile.tracksAmmo ? Math.min(needed, profile.ammo) : needed;
        if (profile.tracksAmmo && (profile.ammo < roundsFired || mode === "auto" && roundsFired < 3)) {
            throw new Error("The weapon does not have enough ammunition to fire.");
        }
        const target = state.participants.find((entry) => entry.key === "defender");
        const modifier = RangedCombatRules.computeModifierDice(state, attacker);
        const difficulty = RangedCombatRules.computeRequiredDifficulty(state, modifier);
        const malfunction = Number(attacker.total) >= profile.malfunctionThreshold;
        attacker.successLevel = CoC7CheckResolver.evaluateResult(Number(attacker.total), Number(attacker.targetValue));
        const isHit = !malfunction && (CoC7CheckResolver.LEVEL_RANK[attacker.successLevel] ?? 0)
            >= (CoC7CheckResolver.LEVEL_RANK[difficulty] ?? 2);
        attacker.isSuccess = isHit;
        const { hits, impales } = RangedCombatRules.computeHitsForShot({
            isHit, successLevel: attacker.successLevel, fireMode: mode,
            bulletsNeeded: roundsFired, isImpalingWeapon: profile.isImpaling
        });

        let effectiveHits = hits;
        let effectiveImpales = impales;
        let friendlyFireTarget = null;
        if (!isHit && !malfunction && state.tacticalFlags?.inMelee && attacker.successLevel === "fumble") {
            friendlyFireTarget = this.#resolveFriendlyFireTarget(state, actor, target);
            if (friendlyFireTarget) {
                effectiveHits = 1;
                effectiveImpales = 0;
            }
        }

        const remainingAmmo = await RangedWeaponService.consumeWeaponAmmo(weapon, roundsFired);
        if (malfunction) await RangedWeaponService.setWeaponMalfunction(weapon, true);
        const shot = this.#recordShot(state, attacker, friendlyFireTarget ?? target, profile, {
            roundsFired,
            hits: effectiveHits,
            impales: effectiveImpales,
            isHit: isHit || Boolean(friendlyFireTarget),
            malfunction,
            isFriendlyFire: Boolean(friendlyFireTarget)
        });
        state.remainingAmmo = remainingAmmo;
        state.weaponProfile = { ...profile, ammo: remainingAmmo, isJammed: malfunction };
        state.rangedMalfunction = malfunction;
        const canContinue = this.#canContinue(state, profile, remainingAmmo, malfunction);
        if (effectiveHits > 0) {
            state.rangedEndAfterDamage = !canContinue;
            if (!canContinue && mode === "auto") state.autoFireEnded = true;
            return this.#buildShotDamageParticipants(state, attacker, actor, shot);
        }
        if (canContinue) {
            attacker.hasRolled = false;
            return [];
        }
        if (mode === "auto") state.autoFireEnded = true;
        return this.finishAttack(state);
    }

    #canContinue(state, profile, remainingAmmo, malfunction) {
        if (malfunction) return false;
        if (state.rangedFireMode === "auto") return remainingAmmo === null || remainingAmmo >= 3;
        return RangedCombatRules.getRemainingRoundCapacity(state, profile) > 0
            && (remainingAmmo === null || remainingAmmo >= RangedCombatRules.getBulletsForNextAction(state.rangedFireMode, profile));
    }

    #recordShot(state, attacker, target, profile, result) {
        const number = Number(state.rangedShotsFired ?? 0) + 1;
        const mode = state.rangedFireMode || "single";
        const targetKey = result.isFriendlyFire
            ? target.tokenId
            : (state.rangedTargetTokenId || target?.actorUuid || target?.actorId || "");
        const shot = {
            index: number, fireMode: mode, targetKey, targetActorId: target?.actorId ?? "",
            targetActorUuid: target?.actorUuid ?? "", targetName: target?.actorName ?? "",
            total: attacker.total, successLevel: attacker.successLevel, isHit: result.isHit,
            malfunction: result.malfunction, isFriendlyFire: Boolean(result.isFriendlyFire),
            bulletsSpent: result.roundsFired, hits: result.hits,
            impales: result.impales, modifierDice: attacker.rollBreakdown?.modifierDice ?? 0,
            rollBreakdown: attacker.rollBreakdown
        };
        if (mode === "auto") {
            state.volleyLog = [...(state.volleyLog ?? []), {
                volleyNumber: number, targetKey, targetName: shot.targetName, total: attacker.total,
                targetValue: attacker.targetValue, successLevel: attacker.successLevel, isHit: result.isHit,
                isImpale: result.impales > 0, roundsFired: result.roundsFired, roundsHit: result.hits
            }];
            state.volleyCount = number;
            state.rangedVolleyIndex = number;
        }
        state.rangedShots = [...(state.rangedShots ?? []), shot];
        state.rangedHits = [...(state.rangedHits ?? []), ...this.#buildVolleyHits(state, shot, profile)];
        state.participants.push({ ...attacker, key: `shot_${number}`, hasRolled: true, isShotDetail: true });
        state.rangedShotsFired = Number(state.rangedShotsFired ?? 0) + 1;
        state.rangedBulletsSpent = Number(state.rangedBulletsSpent ?? 0) + result.roundsFired;
        state.lastVolleyTargetTokenId = state.rangedTargetTokenId;
        state.traversePenaltyDice = 0;
        state.traverseDistance = 0;
        return shot;
    }

    #resolveFriendlyFireTarget(state, attackerActor, targetParticipant) {
        const tokens = canvas?.tokens?.placeables ?? [];
        const targetToken = (state.rangedTargetTokenId ? tokens.find((t) => t.id === state.rangedTargetTokenId) : null)
            ?? (targetParticipant ? tokens.find((t) => t.actor?.id === targetParticipant.actorId) : null);
        const allies = RangedWeaponService.findMeleeAllies(attackerActor, targetToken);
        if (!allies.length) return null;

        const chosen = allies[Math.floor(Math.random() * allies.length)];
        return {
            tokenId: chosen.id,
            actorId: chosen.actor.id,
            actorUuid: chosen.actor.uuid ?? "",
            actorName: chosen.name || chosen.actor.name
        };
    }

    #buildVolleyHits(state, shot, profile) {
        const hits = [];
        const formula = RangedCombatRules.resolveRangeDamageFormula(state, profile);
        for (let index = 0; index < shot.hits; index++) {
            hits.push({
                targetKey: shot.targetKey, targetActorId: shot.targetActorId,
                targetActorUuid: shot.targetActorUuid, targetName: shot.targetName,
                shotNumber: shot.index, impale: index < shot.impales, formula
            });
        }
        if (shot.hits > 0 && profile.isShotgun) {
            const spreadTargets = RangedCombatRules.resolveShotgunSpreadTargets(state, profile, shot);
            for (const extra of spreadTargets) {
                hits.push({
                    ...extra,
                    shotNumber: shot.index,
                    impale: false,
                    formula
                });
            }
        }
        return hits;
    }

    #buildShotDamageParticipants(state, winner, winnerActor, shot) {
        const shotHits = state.rangedHits.filter((hit) => hit.shotNumber === shot.index);
        const groups = new Map();
        for (const hit of shotHits) {
            const key = hit.targetKey || hit.targetActorUuid || hit.targetActorId;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(hit);
        }
        const baseIndex = state.participants.filter((entry) => entry.key === "damage" || entry.key.startsWith("damage_")).length;
        return Array.from(groups.entries(), ([targetKey, targetHits], idx) => ({
            ...this.#buildTargetDamageParticipant(state, winner, winnerActor, targetKey, targetHits, baseIndex + idx),
            shotNumber: shot.index
        }));
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

    /** Finishes a ranged series and applies completed consequences when automation is enabled. */
    async finishAttack(state) {
        const followUps = this.advanceToResolution(state);
        const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
        if (autoApply && !followUps.length && state.hasPendingConsequences && !state.consequencesApplied) {
            await this.applyConsequences(state);
            state.consequencesApplied = true;
            state.hasPendingConsequences = false;
        }
        return followUps;
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
        const isCurrentBatch = Array.isArray(damageParticipant.rangedHitResults);
        const hitResults = isCurrentBatch ? damageParticipant.rangedHitResults
            : Array.isArray(state.rangedHitResults) && state.rangedHitResults.length > 0 ? state.rangedHitResults
                : [{
                    targetActorId: defaultActor?.id ?? "", targetActorUuid: defaultActor?.uuid ?? "",
                    rawDamage: Number(damageParticipant.total ?? 0), impale: false
                }];

        const summary = RangedCombatRules.evaluateMultiHitDamage(hitResults, defaultActor);
        state.rawDamage = (isCurrentBatch ? Number(state.rawDamage ?? 0) : 0) + summary.rawDamage;
        state.armorApplied = (isCurrentBatch ? Number(state.armorApplied ?? 0) : 0) + summary.armorApplied;
        state.finalDamage = (isCurrentBatch ? Number(state.finalDamage ?? 0) : 0) + summary.finalDamage;
        state.majorWoundTriggered = Boolean(isCurrentBatch && state.majorWoundTriggered || summary.majorWoundTriggered);
        state.rangedDamageByActor = isCurrentBatch
            ? RangedDamageState.merge(state.rangedDamageByActor, summary.damageByActor) : summary.damageByActor;
        state.pendingRangedDamageByActor = summary.damageByActor;
        state.pendingDamageKey = damageParticipant.key;
        state.rangedDamageDecisionStarted = true;
        state.hasPendingConsequences = true;
        state.consequencesApplied = false;
    }

    /** Applies or discards one pending damage roll and resumes the ranged attack. */
    async decideDamageConsequences(session, action) {
        const state = { ...session, participants: session.participants.map((participant) => ({ ...participant })) };
        if (!state.pendingDamageKey) state.pendingRangedDamageByActor = state.rangedDamageByActor;
        state.rangedDamageDecisionStarted = true;
        await this.#completeDamageDecision(state, action);
        return state;
    }

    async #completeDamageDecision(state, action) {
        if (action === "apply") await this.#applyDamageEntries(state.pendingRangedDamageByActor);
        state.pendingDamageKey = "";
        state.pendingRangedDamageByActor = null;
        state.hasPendingConsequences = false;
        const hasMorePendingDamage = state.participants.some((entry) =>
            (entry.key === "damage" || entry.key.startsWith("damage_")) && !entry.hasRolled
        );
        if (state.rangedEndAfterDamage && !hasMorePendingDamage) {
            const followUps = await this.finishAttack(state);
            state.participants.push(...followUps);
        } else if (state.combatPhase === "attack" && !hasMorePendingDamage) {
            state.participants.find((entry) => entry.key === "attacker").hasRolled = false;
        }
        this.#flagPendingCoverConsequence(state);
        if (state.combatPhase === "resolution" && !state.hasPendingConsequences) state.consequencesApplied = true;
        state.phase = state.combatPhase === "attack" ? "rolling" : "awaitingResolution";
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
        if (!state.rangedDamageDecisionStarted) await this.#applyDamageEntries(state.rangedDamageByActor);

        const targets = [...(state.rangedCoverTargets ?? [])];
        const defender = state.participants?.find((p) => p.key === "defender");
        if (defender?.tookCover) targets.push(defender);
        for (const target of targets) {
            const targetActor = SessionStore.resolveActor(target);
            if (targetActor) await CoC7DataMapper.setCondition(targetActor, "prone", true);
        }
    }

    async #applyDamageEntries(damageByActor) {
        const targets = RangedDamageState.entries(damageByActor).map((entry) => this.#resolveDamageTarget(entry));
        for (const { actor, info } of targets) {
            await CombatConsequenceApplier.applyDamageToActor(actor, info.damage, Boolean(info.majorWound), info.fatalHit ?? null);
        }
    }

    #resolveDamageTarget(entry) {
        const actor = RangedDamageState.resolveActor(entry);
        if (!actor) throw new Error(`Cannot apply ranged damage: target actor "${entry.actorUuid || entry.actorId}" is unavailable.`);
        if (entry.info.damage == null || !Number.isFinite(Number(entry.info.damage))) {
            throw new Error("Cannot apply ranged damage: the recorded damage is invalid.");
        }
        return { actor, info: entry.info };
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
