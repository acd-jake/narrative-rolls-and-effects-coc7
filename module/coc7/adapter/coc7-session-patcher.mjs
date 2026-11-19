import { SessionStore } from "../../core-bridge.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { RangedCombatRules } from "../ranged/ranged-combat-rules.mjs";
import { RangedRollStrategy } from "../strategies/ranged-roll-strategy.mjs";
import { CombatDamageDecision } from "../strategies/combat-damage-decision.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";

/** Validates CoC7 roll submissions and applies phase-aware session updates. */
export class CoC7SessionPatcher {

    /** Verifies that a submitted roll uses the modifier dice allowed by its session state. */
    validateSubmittedRoll(session, participant, rollData) {
        if (participant.key === "damage" || participant.key.startsWith("damage_")) {
            return !CombatDamageDecision.pendingKey(session);
        }
        if (session.rollType === "other") return true;
        if (participant.key === "defender" && session.rollType === "ranged") return session.combatPhase === "reaction";
        if (participant.key === "defender" && session.defenderReaction === "none") return true;
        let expected = Number(participant.modifierDice ?? 0);
        if (session.rollType === "combat" && participant.key === "attacker") {
            const flags = session.tacticalFlags ?? {};
            expected += Number(Boolean(flags.outnumbered)) + Number(Boolean(flags.surprised)) +
                Number(Boolean(flags.pointBlank)) + Number(Boolean(flags.proneTarget)) - Number(Boolean(flags.cover));
        }
        if (session.rollType === "ranged" && participant.key === "attacker") {
            if (session.combatPhase !== "attack" || RangedCombatRules.hasSpentRoundAiming(SessionStore.resolveActor(participant))) return false;
            expected = RangedCombatRules.computeModifierDice(session, participant);
            if (CombatDamageDecision.pendingKey(session)) return false;
            if (session.participants.some((entry) => entry.shotNumber && !entry.hasRolled)) return false;
            if (session.rangedFireMode === "auto" && (session.combatPhase !== "attack" || expected < -2)) return false;
        }
        return Number(rollData.modifierDice ?? 0) === Math.clamp(expected, -2, 2);
    }

    /** Applies CoC7 phase resets, defender reactions, and ranged series actions to session patches. */
    transformSessionPatch(session, patch) {
        if (session.rollType === "ranged" && patch.rangedAimAction) return this.#handleAiming(session, patch.rangedAimAction, patch.rangedAimMessageId);
        if (session.rollType === "ranged" && patch.stopAutoFire === true) return this.#stopAutoFire(session);
        if (session.rollType === "ranged" && patch.finishRangedAttack === true) return this.#finishRangedAttack(session);
        if (session.rollType === "ranged" && patch.switchRangedTarget) {
            return this.#switchRangedTarget(session, patch.switchRangedTarget);
        }
        if (patch.resetCombatPhase || patch.resetSanityPhase) {
            if (session.consequencesApplied || CombatDamageDecision.pendingKey(session)) return session;
            const clearResult = {
                hasRolled: false, total: null, successLevel: "", isSuccess: false,
                isPushed: false, luckDecided: false, pushDecided: false, luckSpent: 0, rollBreakdown: null
            };
            if (patch.resetCombatPhase && session.rollType === "combat") {
                return this.#rewindCombatPhase(session, patch.resetCombatPhase, clearResult);
            }
            if (patch.resetSanityPhase && session.rollType === "sanity") {
                return this.#rewindSanityPhase(session, patch.resetSanityPhase, clearResult);
            }
            return session;
        }
        if (session.rollType === "combat" && ("defenderReaction" in patch || "reactionDetail" in patch)) {
            return this.#transformDefenderPatch(session, patch);
        }
        return { ...session, ...patch };
    }

    async #handleAiming(session, action, messageId) {
        if (session.isResolved || session.isPreparingModifiers) return session;
        const attacker = session.participants?.find((entry) => entry.key === "attacker");
        const actor = SessionStore.resolveActor(attacker);
        if (!actor) throw new Error("Cannot change aiming state without the attacker.");
        if (action === "fire" && session.combatPhase === "aimChoice") {
            if (RangedCombatRules.hasSpentRoundAiming(actor)) return session;
            return { ...session, combatPhase: "reaction" };
        }
        if (action === "start" && session.combatPhase === "aimChoice") {
            if (RangedCombatRules.hasSpentRoundAiming(actor)) return session;
            const combat = RangedCombatRules.getActiveCombat();
            const aiming = { combatId: combat?.id ?? "", round: Number(combat?.round ?? 0), messageId };
            await actor.setFlag(COC7_MODULE_ID, "aimingAction", aiming);
            return { ...session, combatPhase: "aiming", rangedAiming: aiming };
        }
        if (action === "finish" && session.combatPhase === "aiming") {
            if (!session.rangedAiming) throw new Error("Cannot finish aiming without the starting round.");
            if (RangedCombatRules.getAimingStatus(session.rangedAiming) === "waiting") return session;
            await actor.unsetFlag(COC7_MODULE_ID, "aimingAction");
            return { ...session, combatPhase: "reaction", tacticalFlags: { ...session.tacticalFlags, aiming: true } };
        }
        return session;
    }

    #stopAutoFire(session) {
        if (session.isResolved || session.combatPhase !== "attack" || session.rangedFireMode !== "auto" || !session.volleyCount) return session;
        return this.#finishRangedAttack(session);
    }

    async #finishRangedAttack(session) {
        if (session.isResolved || session.combatPhase !== "attack" || !session.rangedShotsFired) return session;
        if (CombatDamageDecision.pendingKey(session)) return session;
        if (session.participants.some((entry) => entry.shotNumber && !entry.hasRolled)) return session;
        const participants = session.participants.map((participant) =>
            participant.key === "attacker" ? { ...participant, hasRolled: true } : participant
        );
        const state = { ...session, participants, autoFireEnded: session.rangedFireMode === "auto" };
        const followUps = await new RangedRollStrategy().finishAttack(state);
        state.participants.push(...followUps);
        state.phase = followUps.length ? "rolling" : "awaitingResolution";
        return state;
    }

    #switchRangedTarget(session, tokenId) {
        if (session.isResolved || session.combatPhase !== "attack" || !["auto", "multiple"].includes(session.rangedFireMode) || !session.rangedShotsFired) return session;
        if (CombatDamageDecision.pendingKey(session)) return session;
        if (session.participants.some((entry) => entry.shotNumber && !entry.hasRolled)) return session;
        const tokens = canvas?.tokens?.placeables ?? [];
        const defender = session.participants.find((entry) => entry.key === "defender");
        const previous = tokens.find((token) => token.id === session.lastVolleyTargetTokenId)
            ?? tokens.find((token) => token.id === session.rangedTargetTokenId)
            ?? tokens.find((token) => token.actor?.id === defender?.actorId);
        const next = tokens.find((token) => token.id === tokenId);
        if (!previous || !next?.actor) throw new Error("Cannot switch targets without both scene tokens.");
        const traverse = session.rangedFireMode === "auto"
            ? RangedCombatRules.measureTraverse(previous, next) : { distance: 0, penalty: 0 };
        if (!traverse) throw new Error("Cannot measure the target traverse distance.");
        const coverTargets = [...(session.rangedCoverTargets ?? [])];
        if (defender.tookCover && !coverTargets.some((entry) => entry.tokenId === session.rangedTargetTokenId)) {
            coverTargets.push({ ...defender, tokenId: session.rangedTargetTokenId });
        }
        const updated = {
            ...SessionStore.buildParticipant("defender", next.actor, defender.label, 0),
            hasRolled: true, tookCover: coverTargets.some((entry) => entry.tokenId === next.id)
        };
        return {
            ...session,
            participants: session.participants.map((participant) => participant.key === "defender" ? updated : participant),
            rangedTargetTokenId: next.id, traverseDistance: traverse.distance, traversePenaltyDice: traverse.penalty,
            rangedCoverTargets: coverTargets
        };
    }

    #rewindCombatPhase(session, resetPhase, clearResult) {
        const key = { initiator: "attacker", opponent: "defender" }[resetPhase];
        if (!key || !session.participants.find((participant) => participant.key === key)?.hasRolled) return session;
        const participants = session.participants
            .filter((participant) => participant.key !== "damage")
            .map((participant) => this.#clearParticipantResult(participant, key, clearResult));
        return {
            ...session,
            participants,
            combatPhase: "initiator",
            phase: "rolling",
            hitWinnerKey: "",
            rawDamage: null,
            armorApplied: 0,
            finalDamage: null,
            damagePreview: null,
            majorWoundTriggered: false,
            hasPendingConsequences: false,
            winnerKey: "",
            outcomeHeadline: ""
        };
    }

    #rewindSanityPhase(session, resetPhase, clearResult) {
        const key = { check: "p0", insight: "insanityInt" }[resetPhase];
        if (!key || !session.participants.find((participant) => participant.key === key)?.hasRolled) return session;
        const participants = session.participants
            .filter((participant) => key !== "p0" || participant.key !== "insanityInt")
            .map((participant) => this.#clearParticipantResult(participant, key, clearResult));
        const sanityFields = key === "p0"
            ? {
                sanityLost: null, sanityTriggersBout: false, sanityTriggersIndefinite: false,
                sanityPermanentInsanity: false, boutDurationRounds: null, tempInsanityHours: null,
                hasPendingConsequences: false
            }
            : { boutDurationRounds: null, tempInsanityHours: null, hasPendingConsequences: true };
        return { ...session, ...sanityFields, participants, phase: "rolling", winnerKey: "", outcomeHeadline: "" };
    }

    #clearParticipantResult(participant, key, clearResult) {
        return participant.key === key ? { ...participant, ...clearResult } : participant;
    }

    #transformDefenderPatch(session, patch) {
        const defender = session.participants.find((participant) => participant.key === "defender");
        if (!defender || defender.hasRolled) return session;
        if ("defenderReaction" in patch) return this.#updateDefenderReaction(session, patch.defenderReaction);
        return this.#updateReactionDetail(session, defender, patch.reactionDetail);
    }

    #updateDefenderReaction(session, reaction) {
        if (!["dodge", "fightBack", "maneuver", "none"].includes(reaction)) return session;
        const targetValue = reaction === "dodge" ? session.defenderDodgeValue
            : reaction === "fightBack" || reaction === "maneuver" ? session.defenderFightBackValue : 0;
        return {
            ...session,
            defenderReaction: reaction,
            participants: session.participants.map((participant) =>
                this.#resetDefenderForReaction(participant, reaction, targetValue)
            )
        };
    }

    #resetDefenderForReaction(participant, reaction, targetValue) {
        if (participant.key !== "defender") return participant;
        return {
            ...participant,
            label: game.i18n.localize(`ROE_COC7.Combat.DefenseModes.${reaction}`),
            targetValue,
            hasRolled: false,
            total: null,
            successLevel: "",
            isSuccess: false
        };
    }

    #updateReactionDetail(session, defender, detail) {
        if (session.defenderReaction === "maneuver") {
            return ["disarm", "grapple", "knockdown", "push"].includes(detail)
                ? { ...session, maneuverType: detail } : session;
        }
        if (session.defenderReaction === "fightBack") {
            return this.#updateFightBackWeapon(session, defender, detail);
        }
        return session;
    }

    #updateFightBackWeapon(session, defender, detail) {
        const actor = SessionStore.resolveActor(defender);
        const weapon = detail === "unarmed" ? null : actor?.items.get(detail);
        if (!actor || (detail !== "unarmed" && weapon?.type !== "weapon")) return session;
        const skill = CoC7DataMapper.findActorSkill(actor, weapon
            ? weapon.system?.skill?.main
            : { name: game.i18n.localize("ROE_COC7.SkillList.FightingBrawl") });
        const label = weapon
            ? `${weapon.name} (${skill?.name || game.i18n.localize("ROE_COC7.Combat.DefenseTabs.fightBack")})`
            : game.i18n.localize("ROE_COC7.Combat.DefenseModes.fightBack");
        return {
            ...session,
            defenderWeaponId: detail,
            participants: session.participants.map((participant) =>
                this.#updateDefenderWeapon(participant, weapon, skill, label, session)
            )
        };
    }

    #updateDefenderWeapon(participant, weapon, skill, label, session) {
        if (participant.key !== "defender") return participant;
        return {
            ...participant,
            itemId: weapon?.id ?? "",
            label,
            targetValue: skill ? CoC7DataMapper.getSkillValue(skill) : session.defenderFightBackValue
        };
    }
}
