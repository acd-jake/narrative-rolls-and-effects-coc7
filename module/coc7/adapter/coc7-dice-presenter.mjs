import { EffectsEngine } from "../../core-bridge.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";

const EFFECT_PRESETS = {
    majorWound: { color: 0xb81414, secondaryColor: 0x5c0505, count: 28, durationMs: 1400, gravity: 0.14, spread: 2.6 },
    temporaryInsanity: { color: 0x7b2cbf, secondaryColor: 0x240046, count: 36, durationMs: 2000, gravity: -0.06, spread: 3.2 },
    indefiniteInsanity: { color: 0x4a0e4e, secondaryColor: 0x0d0221, count: 48, durationMs: 2600, gravity: -0.08, spread: 3.8 },
    mythosSpell: { color: 0x10b981, secondaryColor: 0x064e3b, count: 44, durationMs: 2200, gravity: -0.1, spread: 3.5 },
    dying: { color: 0x8a1c1c, secondaryColor: 0x1a0000, count: 20, durationMs: 1800, gravity: 0.18, spread: 1.8 }
};

/** Formats CoC7 roll visuals and triggers system-specific effects. */
export class CoC7DicePresenter {

    /** Formats a participant's resolved result for the session summary. */
    formatResolvedParticipant(participant, session) {
        if (session.rollType === "ranged" && participant.key === "defender") {
            return game.i18n.localize(participant.tookCover ? "ROE_COC7.Ranged.CoverTaken" : "ROE_COC7.Ranged.NoCover");
        }
        if (participant.total === null) return game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none");
        if (session.rollType === "other" || participant.key === "damage") return String(participant.total ?? "");
        const outcome = CoC7ResultFormatter.formatRollOutcome(participant);
        return CoC7ResultFormatter.formatPushedOutcome(outcome, participant, true, session);
    }

    /** Builds a permission-aware result badge for a participant in a chat card. */
    formatParticipantBadge(participant, session, permissions) {
        if (!permissions.showDetails) {
            return { text: game.i18n.localize("ROE_COC7.Combat.Card.HiddenUntilOwnRoll"), className: "pending-badge" };
        }
        if (participant.total === null) {
            return { text: game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none"), className: "pending-badge" };
        }
        if (participant.key === "damage") {
            return permissions.canViewRoll
                ? { text: `${participant.total} (${participant.diceFormula})` }
                : { text: game.i18n.localize("ROE.RollSession.HiddenRoll"), className: "pending-badge" };
        }
        if (session.rollType === "other") {
            return permissions.canViewRoll
                ? { text: String(participant.total) }
                : { text: game.i18n.localize("ROE.RollSession.HiddenRoll"), className: "pending-badge" };
        }
        const allowNumbers = permissions.canViewRoll && (permissions.isGM || Boolean(permissions.actor?.testUserPermission(game.user, "OBSERVER")));
        const outcome = CoC7ResultFormatter.formatRollOutcome({
            total: participant.total,
            targetValue: participant.targetValue,
            successLevel: participant.successLevel,
            allowNumbers
        });
        const text = CoC7ResultFormatter.formatPushedOutcome(outcome, participant, permissions.canViewRoll, session);
        const isPushFailure = CoC7ResultFormatter.isVisiblePushFailure(participant, session, permissions.canViewRoll);
        const className = `roll-badge ${participant.successLevel ?? ""}${isPushFailure ? " is-pushed-failure" : ""}`;
        return { text, className };
    }

    /** Renders regular, hard, and extreme target numbers for the roll-inspection view. */
    formatInspectionThresholds(breakdown) {
        if (breakdown.targetValue <= 0) return "";
        return `<div class="inspect-thresholds"> <span>${game.i18n.localize("ROE_COC7.Difficulty.Regular")}: <strong>${breakdown.targetValue}</strong></span> <span>${game.i18n.localize("ROE_COC7.Difficulty.Hard")}: <strong>${breakdown.hardThreshold}</strong></span> <span>${game.i18n.localize("ROE_COC7.Difficulty.Extreme")}: <strong>${breakdown.extremeThreshold}</strong></span> </div>`;
    }

    /** Converts dice-visualizer entries into a concise, localized formula label. */
    formatDiceFormulaLabel(diceArray) {
        const counts = { units: 0, tens: 0, bonus: 0, penalty: 0 };
        const otherDice = [];
        for (const die of diceArray) this.#accumulateDiceLabel(die, counts, otherDice);
        const parts = [];
        if (counts.units) parts.push(`${counts.units}D10`);
        this.#appendTensLabel(parts, counts);
        for (const die of otherDice) parts.push(`${die.count}d${this.#extractDiceSides(die.label)}`);
        return parts.join(", ");
    }

    /** Adds bonus- or penalty-die icons to the visuals for a percentile roll. */
    extendDiceVisuals(dice, session, modifierDice) {
        if (session?.rollType === "other") return dice;
        const modifier = Math.clamp(Number(modifierDice) || 0, -2, 2);
        const modifierVisuals = [];
        for (let i = 0; i < Math.abs(modifier); i++) {
            const isBonus = modifier > 0;
            modifierVisuals.push({
                src: `modules/narrative-rolls-and-effects-coc7/assets/dice/d10-${isBonus ? "bonus" : "penalty"}.svg`,
                label: isBonus ? `ROE.Roll.BonusDie` : `ROE.Roll.PenaltyDie`,
                count: 1,
                multiple: false
            });
        }
        const unitsIndex = dice.findIndex((die) => die.label === "ROE.Dice.D10Units");
        if (unitsIndex === -1) return [...dice, ...modifierVisuals];
        return [...dice.slice(0, unitsIndex), ...modifierVisuals, ...dice.slice(unitsIndex)];
    }
    // Effects engine integration points

    /** Maps an actor's Sanity value to an atmosphere state, or returns null when none applies. */
    evaluateAtmosphereState(actor) {
        const san = CoC7DataMapper.getResource(actor, "sanity");
        if (!san || typeof san.value !== "number") return null;
        if (san.value <= 20) return "critical";
        if (san.value <= 45) return "unease";
        return null;
    }

    /** Selects the visual effect associated with a participant's roll result, if any. */
    getRollEffectType(participant) {
        if (participant.successLevel === "fumble") return "fumble";
        if (participant.successLevel === "critical") return "critical";
        if (participant.isPushed && !participant.isSuccess) return "fumble";
        return null;
    }

    /** Reports whether an actor's updated Sanity should trigger the low-resource sound. */
    didTriggerLowResourceSound(actor, changed) {
        const newSanity = changed.system?.attribs?.san?.value;
        return typeof newSanity === "number" && newSanity <= 20;
    }

    /** Formats a bonus- or penalty-die count for modifier-preparation controls. */
    formatModifierLabel(modifier) {
        if (modifier > 0) {
            const label = game.i18n.localize(modifier === 1 ? `ROE.Roll.BonusDie` : `ROE.Roll.BonusDice`);
            return `${modifier} ${label}`;
        }
        if (modifier < 0) {
            const count = Math.abs(modifier);
            const label = game.i18n.localize(count === 1 ? "ROE.Roll.PenaltyDie" : "ROE.Roll.PenaltyDice");
            return `${count} ${label}`;
        }
        return game.i18n.localize("ROE.Roll.BonusPenaltyLabel");
    }

    #accumulateDiceLabel(die, counts, otherDice) {
        const count = die.count || 1;
        const labels = {
            "ROE.Dice.D10Units": "units",
            "ROE.Dice.D10Tens": "tens",
            "ROE_COC7.Dice.D10Units": "units",
            "ROE_COC7.Dice.D10Tens": "tens",
            "ROE.Roll.BonusDie": "bonus",
            "ROE.Roll.PenaltyDie": "penalty"
        };
        const countKey = labels[die.label];
        if (countKey) counts[countKey] += count;
        else otherDice.push({ count, label: die.label });
    }

    #appendTensLabel(parts, counts) {
        const total = counts.tens + counts.bonus + counts.penalty;
        if (!total) return;
        let label = `${total}D10 ${game.i18n.localize("ROE_COC7.Dice.Tens")}`;
        const modifiers = [];
        if (counts.bonus) modifiers.push(`${counts.bonus} ${game.i18n.localize(counts.bonus === 1 ? "ROE.Roll.BonusDie" : "ROE.Roll.BonusDice")}`);
        if (counts.penalty) modifiers.push(`${counts.penalty} ${game.i18n.localize(counts.penalty === 1 ? "ROE.Roll.PenaltyDie" : "ROE.Roll.PenaltyDice")}`);
        if (modifiers.length) label += ` (${modifiers.join(", ")})`;
        parts.push(label);
    }

    #extractDiceSides(label) {
        const matches = label.match(/D(\d+)/i);
        return matches?.[1] ?? "?";
    }

    /** Registers the visual effect presets used by CoC7 roll outcomes. */
    registerEffectPresets() {
        for (const [key, preset] of Object.entries(EFFECT_PRESETS)) {
            EffectsEngine.registerPreset(key, preset);
        }
    }
}
