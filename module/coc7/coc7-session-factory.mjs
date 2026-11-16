import { SessionStore } from "../core-bridge.mjs";
import { CoC7DataMapper } from "./coc7-data-mapper.mjs";

export class CoC7SessionFactory {
    static createBasicOrOther({ actor, label, targetValue = 0, difficulty = "regular", diceFormula = "1d100", isOther = false, prepareModifiers = false }) {
        return {
            rollType: isOther ? "other" : "basic",
            prepareModifiers,
            title: label,
            difficulty,
            diceFormula,
            participants: [SessionStore.buildParticipant("p0", actor, label, targetValue)]
        };
    }

    static createSkillCheck({ actor, item = null, label, targetValue, difficulty = "regular", canChangeDifficulty = true, canPush = item?.system?.properties?.push !== false, prepareModifiers = false }) {
        return {
            rollType: "skill",
            prepareModifiers,
            title: label,
            difficulty,
            canChangeDifficulty,
            canPush,
            participants: [SessionStore.buildParticipant("p0", actor, label, targetValue, item?.id ?? "")]
        };
    }

    static createSanityCheck({ actor, label, lossSuccess = "0", lossFailure = "1d6", prepareModifiers = false }) {
        const currentSan = Number(CoC7DataMapper.getResource(actor, "sanity")?.value ?? 0);
        const sanLabel = game.i18n.localize("ROE_COC7.Resources.Sanity");
        return {
            rollType: "sanity",
            prepareModifiers,
            title: label || sanLabel,
            difficulty: "regular",
            canChangeDifficulty: false,
            sanityLossSuccess: lossSuccess,
            sanityLossFailure: lossFailure,
            participants: [SessionStore.buildParticipant("p0", actor, sanLabel, currentSan)]
        };
    }

    static createCombined({ actor, checks, combinedMode = "and", difficulty = "regular", prepareModifiers = false }) {
        return {
            rollType: "combined",
            prepareModifiers,
            title: checks.map((c) => c.label).join(" + "),
            difficulty,
            combinedMode,
            canPush: checks.every((c) => {
                if (c.isLuck || c.canPush === false) return false;
                if (!c.itemId) return true;
                const skill = actor.items?.get?.(c.itemId);
                return Boolean(skill && skill.system?.properties?.push !== false);
            }),
            participants: checks.map((c, i) => SessionStore.buildParticipant(`c${i}`, actor, c.label, c.targetValue, c.itemId ?? ""))
        };
    }

    static createOpposed({ title, contestants, prepareModifiers = false }) {
        return {
            rollType: "opposed",
            prepareModifiers,
            title,
            difficulty: "regular",
            participants: contestants.map((c, i) => SessionStore.buildParticipant(`op${i}`, c.actor, c.label, c.targetValue))
        };
    }

    static createCombat({ attacker, defender = null, weapon, attackSkillLabel, attackTargetValue, difficulty = "regular", prepareModifiers = false }) {
        const participants = [SessionStore.buildParticipant("attacker", attacker, attackSkillLabel, attackTargetValue, weapon?.id ?? "")];
        let dodgeVal = 0;
        let fightBackVal = 0;

        if (defender) {
            const dodgeSkill = defender.items.find((i) => i.type === "skill" && (i.name.toLowerCase().includes("ausweich") || i.name.toLowerCase().includes("dodge")));
            const brawlSkill = CoC7DataMapper.findActorSkill(defender, { name: game.i18n.localize("ROE_COC7.SkillList.FightingBrawl") });

            dodgeVal = dodgeSkill ? CoC7DataMapper.getSkillValue(dodgeSkill) : Math.floor((defender.system?.characteristics?.dex?.value ?? 50) / 2);
            fightBackVal = brawlSkill ? CoC7DataMapper.getSkillValue(brawlSkill) : 25;

            participants.push(SessionStore.buildParticipant("defender", defender, game.i18n.localize("ROE_COC7.Combat.DefenseModes.dodge"), dodgeVal));
        }

        const weaponLabel = weapon?.name || attackSkillLabel;
        return {
            rollType: "combat",
            prepareModifiers,
            combatPhase: "initiator",
            combatType: "melee",
            title: weaponLabel,
            weaponName: weaponLabel,
            weaponImg: weapon?.img || attacker.img,
            difficulty,
            canChangeDifficulty: false,
            damageFormula: weapon?.system?.range?.normal?.damage || "1d6",
            damageBonus: CoC7DataMapper.getCombatValue(attacker, "damageBonus") || "0",
            defenderDodgeValue: dodgeVal,
            defenderFightBackValue: fightBackVal,
            defenderReaction: defender ? "dodge" : "none",
            participants
        };
    }

    static createRanged({ attacker, target, weapon, attackSkillLabel, attackTargetValue, difficulty = "regular", prepareModifiers = false }) {
        const weaponLabel = weapon?.name || attackSkillLabel;
        return {
            rollType: "ranged",
            prepareModifiers,
            combatPhase: "reaction",
            combatType: "ranged",
            title: weaponLabel,
            weaponName: weaponLabel,
            weaponImg: weapon?.img || attacker.img,
            difficulty,
            canChangeDifficulty: false,
            damageFormula: weapon?.system?.range?.normal?.damage || "1d6",
            damageBonus: "0",
            defenderReaction: "none",
            participants: [
                SessionStore.buildParticipant("attacker", attacker, attackSkillLabel, attackTargetValue, weapon?.id ?? ""),
                SessionStore.buildParticipant("defender", target, game.i18n.localize("ROE_COC7.Ranged.Phases.Reaction"), 0)
            ]
        };
    }

    static collectActorChecks(actor, { includeSpecial = true } = {}) {
        if (!actor?.system) return [];
        const list = [];

        const luck = CoC7DataMapper.getResource(actor, "luck");
        if (includeSpecial && luck) {
            const luckLabel = game.i18n.localize("ROE_COC7.Resources.Luck");
            list.push({ value: `luck||${luckLabel}|${luck.value ?? 0}`, display: `${luckLabel} (${luck.value ?? 0}%)` });
        }

        for (const [key, data] of Object.entries(actor.system.characteristics ?? {})) {
            const i18nKey = `ROE_COC7.Characteristics.${key.toUpperCase()}.Label`;
            const label = game.i18n.has(i18nKey) ? game.i18n.localize(i18nKey) : key.toUpperCase();
            list.push({ value: `char||${label}|${data.value ?? 50}`, display: `${label} (${data.value ?? 50}%)` });
        }

        const skills = actor.items
            .filter((i) => i.type === "skill")
            .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

        for (const skill of skills) {
            const val = CoC7DataMapper.getSkillValue(skill);
            list.push({ value: `skill|${skill.id}|${skill.name}|${val}`, display: `${skill.name} (${val}%)` });
        }
        return list;
    }

    static enrichForTemplate(data) {
        const isSanity = data.rollType === "sanity";
        const isCombat = data.rollType === "combat" || data.rollType === "ranged";
        const sanRoll = isSanity ? data.participants?.find((p) => p.key === "p0") ?? data.participants?.at(0) : null;
        const intRoll = isSanity ? data.participants?.find((p) => p.key === "insanityInt") ?? null : null;

        const hasSanityResult = isSanity && data.sanityLost !== null && data.sanityLost !== undefined;
        const hasCombatDamage = isCombat && data.finalDamage !== null && data.finalDamage !== undefined;
        const allRolled = Boolean(data.participants?.length && data.participants.every((p) => p.hasRolled));

        const attacker = isCombat ? data.participants?.find((p) => p.key === "attacker") ?? null : null;
        const defender = isCombat ? data.participants?.find((p) => p.key === "defender") ?? null : null;
        const damageRoll = isCombat ? data.participants?.find((p) => p.key === "damage") ?? null : null;
        const showCombatOpponentPhase = Boolean(isCombat && defender && data.combatType === "melee");
        const reactionKey = data.defenderReaction || "dodge";

        let sanityInsanityBadge = "";
        let sanityRepressedBadge = "";
        if (data.sanityPermanentInsanity) sanityInsanityBadge = game.i18n.localize("ROE_COC7.Sanity.PermanentInsanity");
        else if (data.sanityTriggersIndefinite) sanityInsanityBadge = game.i18n.localize("ROE_COC7.Conditions.IndefiniteInsanity");
        else if (intRoll?.hasRolled) {
            sanityInsanityBadge = intRoll.isSuccess
                ? game.i18n.format("ROE_COC7.Sanity.TemporaryInsanitySummary", { hours: data.tempInsanityHours ?? 1, rounds: data.boutDurationRounds ?? 1 })
                : "";
            if (!intRoll.isSuccess) sanityRepressedBadge = game.i18n.localize("ROE_COC7.Sanity.RepressedHorror");
        }

        let sanitySummaryText = "";
        if (hasSanityResult) {
            const lost = Number(data.sanityLost);
            const parts = [game.i18n.format(lost > 0 ? "ROE_COC7.Sanity.SummaryLoss" : "ROE_COC7.Sanity.SummaryNoLoss", { actor: sanRoll?.actorName ?? "", lost })];
            if (sanityInsanityBadge) parts.push(sanityInsanityBadge);
            else if (sanityRepressedBadge) parts.push(sanityRepressedBadge);
            sanitySummaryText = parts.join(" ");
        }

        const resultBadges = [];
        if (hasSanityResult) {
            const lost = Number(data.sanityLost);
            resultBadges.push(
                { cls: `outcome ${sanRoll?.isSuccess ? "is-success" : "is-failure"}`, label: sanRoll?.successLevel ? game.i18n.localize(`ROE_COC7.SuccessLevels.${sanRoll.successLevel}`) : "" },
                { cls: `loss ${lost ? "is-severe" : "is-safe"}`, icon: "fa-heart-crack", label: game.i18n.format("ROE_COC7.Sanity.CardLossSummary", { lost }) }
            );
        }

        if (isCombat && data.combatPhase === "resolution") {
            const winner = data.participants?.find((p) => p.key === data.hitWinnerKey);
            const winnerKey = winner ? (winner.key === "defender" ? "Defender" : "Attacker") : "Draw";
            if (data.rollType === "ranged") {
                resultBadges.push({ cls: "outcome", icon: winner ? "fa-bullseye" : "fa-ban", label: game.i18n.localize(winner ? "ROE_COC7.Ranged.Badges.Hit" : "ROE_COC7.Ranged.Badges.Miss") });
                if (defender?.tookCover) resultBadges.push({ cls: "outcome", icon: "fa-person-running", label: game.i18n.localize("ROE_COC7.Ranged.Badges.Cover") });
            } else {
                resultBadges.push({ cls: "outcome", icon: winner ? "fa-trophy" : "fa-scale-balanced", label: game.i18n.localize(`ROE_COC7.Combat.Badges.Winner${winnerKey}`) });
            }
            if (winner?.successLevel) resultBadges.push({ cls: "outcome is-success", label: game.i18n.localize(`ROE_COC7.SuccessLevels.${winner.successLevel}`) });
            if (winner?.key === "defender" && data.defenderReaction === "maneuver") {
                resultBadges.push({ cls: "outcome is-success", icon: "fa-hand-fist", label: game.i18n.format("ROE_COC7.Combat.Badges.Maneuver", { maneuver: game.i18n.localize(`ROE_COC7.Combat.Maneuvers.${data.maneuverType || "disarm"}`) }) });
            }
            if (hasCombatDamage) {
                const damage = Number(data.finalDamage);
                resultBadges.push({ cls: `loss  ${damage ? "is-severe" : "is-safe"}`, icon: "fa-burst", label: game.i18n.format("ROE_COC7.Combat.Badges.Damage", { damage }) });
            }
        }
        return {
            ...data,
            resultBadges,
            sanityCheck: sanRoll,
            sanityInsight: intRoll,
            sanitySummaryText,
            rollTypeLabel: game.i18n.localize(`ROE_COC7.RollSession.Types.${data.rollType}`),
            isSanity,
            isCombat,
            hasSanityResult,
            hasCombatDamage,
            hasResult: allRolled && Boolean(data.outcomeHeadline || hasSanityResult || hasCombatDamage),
            resultPartial: isSanity ? "roeResultSanity" : isCombat ? "roeResultCombat" : "roeResultDefault",
            sanityOutcomeLabel: sanRoll?.successLevel ? game.i18n.localize(`ROE_COC7.SuccessLevels.${sanRoll.successLevel}`) : "",
            sanityOutcomeClass: sanRoll?.isSuccess ? "is-success" : "is-failure",
            sanityInsanityBadge,
            sanityRepressedBadge,
            attacker,
            defender,
            damageRoll,
            showCombatOpponentPhase,
            defenderReactionLabel: isCombat ? game.i18n.localize(`ROE_COC7.Combat.DefenseTabs.${reactionKey}`) : ""
        };
    }
}