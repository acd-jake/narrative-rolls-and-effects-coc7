import { SessionStore } from "../../core-bridge.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/** Validates CoC7 roll submissions and applies phase-aware session updates. */
export class CoC7SessionPatcher {
    /** Computes effective CoC 7e ranged modifier dice from tactical flags, cover, and fire mode. */
    static computeRangedModifierDice(session, attacker, { fireMode = null, shotIndex = null, volleyIndex = null } = {}) {
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
    static computeRangedRequiredDifficulty(session, rawModifierDice) {
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

    /** Verifies that a submitted roll uses the modifier dice allowed by its session state. */
    validateSubmittedRoll(session, participant, rollData) {
        if (session.rollType === "other" || participant.key === "damage") return true;
        if (participant.key === "defender" && (session.rollType === "ranged" || session.defenderReaction === "none")) return true;
        let expected = Number(participant.modifierDice ?? 0);
        if (session.rollType === "combat" && participant.key === "attacker") {
            const flags = session.tacticalFlags ?? {};
            expected += Number(Boolean(flags.outnumbered)) + Number(Boolean(flags.surprised)) +
                Number(Boolean(flags.pointBlank)) + Number(Boolean(flags.proneTarget)) - Number(Boolean(flags.cover));
        }
        if (session.rollType === "ranged" && participant.key === "attacker") {
            expected = CoC7SessionPatcher.computeRangedModifierDice(session, participant);
        }
        return Number(rollData.modifierDice ?? 0) === Math.clamp(expected, -2, 2);
    }

    /** Applies CoC7-specific resets and defender-reaction changes to session patches. */
    transformSessionPatch(session, patch) {
        if (patch.resetCombatPhase || patch.resetSanityPhase) {
            if (session.consequencesApplied) return session;
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
