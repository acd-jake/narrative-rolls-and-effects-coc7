import { RollVisibilityPolicy } from "../../core-bridge.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CombatRollStrategy } from "../strategies/combat-roll-strategy.mjs";

/** Builds resolved prompt and chat-card contexts separately for melee and ranged combat. */
export class CoC7CombatResultPresenter {
    /** Dispatches resolved context building to either melee or ranged presentation. */
    static buildResolvedContext(session) {
        return session?.rollType === "ranged"
            ? this.#buildResolvedRangedContext(session)
            : this.#buildResolvedMeleeContext(session);
    }

    static #buildResolvedMeleeContext(session) {
        const base = this.#buildSharedBase(session);
        const { attacker, defender, canViewAtt, canViewDef } = base;
        const names = this.#buildNames(session, attacker, defender);
        const wasDodged = defender && session.defenderReaction === "dodge" && defender.isSuccess;

        let narrativeKey = "ROE_COC7.Combat.ResolvedNarrative.Missed";
        if (session.hitWinnerKey === "attacker") {
            narrativeKey = defender ? "ROE_COC7.Combat.ResolvedNarrative.Hit" : "ROE_COC7.Combat.ResolvedNarrative.HitUnopposed";
        } else if (session.hitWinnerKey === "defender") {
            narrativeKey = session.defenderReaction === "maneuver"
                ? "ROE_COC7.Combat.ResolvedNarrative.Maneuver"
                : "ROE_COC7.Combat.ResolvedNarrative.Counter";
        } else if (wasDodged) {
            narrativeKey = "ROE_COC7.Combat.ResolvedNarrative.Dodged";
        }

        const isManeuverWin = session.hitWinnerKey === "defender" && session.defenderReaction === "maneuver";
        const maneuverLabel = isManeuverWin
            ? game.i18n.format("ROE_COC7.Combat.Badges.Maneuver", {
                maneuver: game.i18n.localize(`ROE_COC7.Combat.Maneuvers.${session.maneuverType || "disarm"}`)
            })
            : "";

        return {
            ...base.fields,
            resolvedCombatNarrative: game.i18n.format(narrativeKey, names),
            resolvedDefenderLabel: game.i18n.localize(`ROE_COC7.Combat.DefenseTabs.${session.defenderReaction || "dodge"}`),
            resolvedCanViewDefender: Boolean(canViewDef && defender?.total !== null),
            resolvedDefenderLevel: defender?.total !== null ? (defender?.successLevel ?? "") : "",
            resolvedDefenderOutcome: this.#formatMeleeDefenderOutcome(defender, canViewDef),
            resolvedHasConsequences: base.fields.resolvedHasDamage || isManeuverWin,
            resolvedManeuverLabel,
            resolvedTargetTookCover: false,
            resolvedHasRangedShots: false,
            resolvedRangedShots: [],
            resolvedRangedMalfunction: false
        };
    }
    static #buildResolvedRangedContext(session) {
        const base = this.#buildSharedBase(session);
        const { attacker, defender, canViewAtt } = base;
        const names = this.#buildNames(session, attacker, defender);
        const allShots = Array.isArray(session.rangedShots) ? session.rangedShots : [];
        const firingShots = allShots.filter((s) => !s.isTargetSwitch);
        const hitCount = Array.isArray(session.rangedHits)
            ? session.rangedHits.length
            : (session.hitWinnerKey === "attacker" ? 1 : 0);

        const resolvedRangedShots = allShots.map((shot) => ({
            ...shot,
            canInspect: canViewAtt && Boolean(shot.rollBreakdown),
            levelLabel: shot.successLevel ? CoC7ResultFormatter.formatSuccessLevel(shot.successLevel) : "",
            outcomeText: canViewAtt
                ? shot.isTargetSwitch
                    ? game.i18n.format("ROE_COC7.Ranged.TargetSwitched", { target: shot.targetName })
                    : shot.malfunction
                        ? `${game.i18n.localize("ROE_COC7.Combat.Malfunction")} (${shot.total})`
                        : `${shot.total} vs. ${attacker?.targetValue ?? 0} • ${CoC7ResultFormatter.formatSuccessLevel(shot.successLevel)}`
                : game.i18n.localize("ROE.RollSession.HiddenRoll")
        }));

        const targetTookCover = Boolean(defender?.tookCover);
        return {
            ...base.fields,
            resolvedCombatNarrative: this.#buildRangedNarrative(session, names, firingShots.length, hitCount),
            resolvedDefenderLabel: game.i18n.localize("ROE_COC7.Combat.TargetLabel"),
            resolvedCanViewDefender: false,
            resolvedDefenderLevel: "",
            resolvedDefenderOutcome: defender
                ? game.i18n.localize(targetTookCover ? "ROE_COC7.Ranged.CoverTaken" : "ROE_COC7.Ranged.NoCover")
                : "",
            resolvedHasConsequences: base.fields.resolvedHasDamage || targetTookCover,
            resolvedManeuverLabel: "",
            resolvedTargetTookCover: targetTookCover,
            resolvedHasRangedShots: resolvedRangedShots.length > 0,
            resolvedRangedShots,
            resolvedRangedMalfunction: Boolean(canViewAtt && session.rangedMalfunction)
        };
    }

    static #buildRangedNarrative(session, names, shotCount, hitCount) {
        const jammed = Boolean(session.rangedMalfunction);
        const mode = session.rangedFireMode || "single";
        const data = { ...names, shots: shotCount, hits: hitCount };

        if (jammed) {
            if (hitCount > 0) return game.i18n.format("ROE_COC7.Ranged.ResolvedNarrative.JamAfterHits", data);
            return game.i18n.format(shotCount > 1 ? "ROE_COC7.Ranged.ResolvedNarrative.JamMultiMiss" : "ROE_COC7.Ranged.ResolvedNarrative.JamSingle", data);
        }
        if (mode === "burst") return game.i18n.format(hitCount > 0 ? "ROE_COC7.Ranged.ResolvedNarrative.BurstHit" : "ROE_COC7.Ranged.ResolvedNarrative.BurstMiss", data);
        if (mode === "auto") return game.i18n.format(hitCount > 0 ? "ROE_COC7.Ranged.ResolvedNarrative.AutoHit" : "ROE_COC7.Ranged.ResolvedNarrative.AutoMiss", data);
        if (mode === "multiple" || shotCount > 1) return game.i18n.format(hitCount > 0 ? "ROE_COC7.Ranged.ResolvedNarrative.MultiHit" : "ROE_COC7.Ranged.ResolvedNarrative.MultiMiss", data);
        return game.i18n.format(hitCount > 0 ? "ROE_COC7.Combat.ResolvedNarrative.RangedHit" : "ROE_COC7.Combat.ResolvedNarrative.RangedMiss", data);
    }

    static #buildSharedBase(session) {
        const attacker = session.participants?.find((p) => p.key === "attacker");
        const defender = session.participants?.find((p) => p.key === "defender") ?? null;
        const damage = session.participants?.find((p) => p.key === "damage") ?? null;
        const canViewAtt = Boolean(attacker && RollVisibilityPolicy.canViewParticipantRoll(attacker, session));
        const canViewDef = Boolean(defender && RollVisibilityPolicy.canViewParticipantRoll(defender, session));
        const canViewDmg = Boolean(damage && RollVisibilityPolicy.canViewParticipantRoll(damage, session));

        const combatLayout = game.settings?.get(COC7_MODULE_ID, "combatResolvedLayout") || "narrative";
        const headerActors = combatLayout === "duel"
            ? game.i18n.localize(`ROE_COC7.RollSession.Types.${session.rollType}`)
            : defender ? `${attacker?.actorName ?? ""} vs. ${defender.actorName ?? ""}` : (attacker?.actorName ?? "");

        const hasDamage = Boolean(session.finalDamage !== null && session.finalDamage !== undefined);
        const damageTarget = CombatRollStrategy.getDamageTarget(session);

        return {
            attacker, defender, canViewAtt, canViewDef,
            fields: {
                resolvedActorName: headerActors.toUpperCase(),
                resolvedTitle: session.weaponName || session.title,
                resolvedAttackerName: attacker?.actorName ?? "",
                resolvedAttackerImg: attacker?.actorImg ?? "",
                resolvedAttackerLabel: attacker?.label ?? "",
                resolvedCanViewAttacker: canViewAtt,
                resolvedAttackerWon: session.hitWinnerKey === "attacker",
                resolvedAttackerLevel: attacker?.successLevel ?? "",
                resolvedAttackerOutcome: attacker ? CoC7ResultFormatter.formatRollOutcome({ total: attacker.total, targetValue: attacker.targetValue, successLevel: attacker.successLevel, allowNumbers: canViewAtt }) : "",
                resolvedAttackerChipClass: this.#getOutcomeChipClass(attacker?.successLevel),
                resolvedHasDefender: Boolean(defender),
                resolvedDefenderName: defender?.actorName ?? "",
                resolvedDefenderImg: defender?.actorImg ?? "",
                resolvedDefenderWon: session.hitWinnerKey === "defender",
                resolvedDefenderChipClass: this.#getOutcomeChipClass(defender?.successLevel),
                resolvedHasDamage: hasDamage,
                resolvedCanViewDamage: canViewDmg,
                resolvedDamageTargetName: canViewDmg ? damageTarget?.actorName || game.i18n.localize("ROE_COC7.Combat.UnknownTarget") : "",
                resolvedFinalDamage: session.finalDamage ?? 0,
                resolvedArmorApplied: Number(session.armorApplied ?? 0),
                resolvedMajorWound: Boolean(canViewDmg && session.majorWoundTriggered)
            }
        };
    }

    static #formatMeleeDefenderOutcome(defender, canView) {
        if (!defender) return "";
        if (defender.total === null) return game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none");
        return CoC7ResultFormatter.formatRollOutcome({ total: defender.total, targetValue: defender.targetValue, successLevel: defender.successLevel, allowNumbers: canView });
    }

    static #buildNames(session, attacker, defender) {
        return {
            attacker: attacker?.actorName ?? "",
            defender: defender?.actorName ?? game.i18n.localize("ROE_COC7.Combat.UnknownTarget"),
            weapon: session.weaponName || session.title,
            maneuver: game.i18n.localize(`ROE_COC7.Combat.Maneuvers.${session.maneuverType || "disarm"}`)
        };
    }

    static #getOutcomeChipClass(level) {
        if (!level || level === "none") return "";
        return ["regular", "hard", "extreme", "critical"].includes(level) ? "outcome is-success" : "outcome is-failure";
    }
}
