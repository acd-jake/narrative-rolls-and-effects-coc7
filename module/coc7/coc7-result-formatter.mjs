import { COC7_MODULE_ID } from "./coc7-settings.mjs";
import { RollVisibilityPolicy } from "../core-bridge.mjs";
import { CoC7CheckResolver } from "./coc7-check-resolver.mjs";

/** Formats check levels and roll outcomes according to the world's display settings. */
export class CoC7ResultFormatter {
    static SYMBOL_MAP = Object.freeze({
        critical: "***!",
        extreme: "***",
        hard: "**",
        regular: "*",
        failure: "-",
        fumble: "---"
    });

    static formatSuccessLevel(successLevel) {
        if (!successLevel) return "";
        const format = game.settings?.get(COC7_MODULE_ID, "successLevelFormat") || "text";
        if (format === "symbols") return this.SYMBOL_MAP[successLevel] ?? "";
        return game.i18n.localize(`ROE_COC7.SuccessLevels.${successLevel}`);
    }

    /** Formats a roll outcome using the configured result display mode. */
    static formatRollOutcome({ total, targetValue, successLevel, allowNumbers = true }) {
        const mode = game.settings?.get(COC7_MODULE_ID, "resultDisplayMode") || "both";
        const levelText = this.formatSuccessLevel(successLevel);
        if (!allowNumbers) {
            if (mode === "numbers" || !levelText) return game.i18n.localize("ROE.RollSession.HiddenRoll");
            return levelText;
        }
        if (mode === "level") return levelText || String(total ?? "");
        const numberPart = targetValue ? `${total} vs. ${targetValue}` : `${total}`;
        if (mode === "numbers" || !levelText) return numberPart;
        return `${numberPart} • ${levelText}`;
    }

    /** Adds the pushed-roll label to an outcome only when the roll is visible. */
    static formatPushedOutcome(outcome, participant, canViewRoll, session) {
        if (!participant?.hasRolled || !participant.isPushed || !canViewRoll) return outcome;
        const label = this.isVisiblePushFailure(participant, session, canViewRoll)
            ? "ROE_COC7.Roll.PushFailureResult"
            : "ROE_COC7.Chat.PushedTag";
        return `${outcome} (${game.i18n.localize(label)})`;
    }

    /** Reports whether a failed push can be disclosed to the current viewer. */
    static isVisiblePushFailure(participant, session, canViewRoll) {
        if (!canViewRoll || !session || !CoC7CheckResolver.didPushFail(session, participant?.key)) return false;
        if (!["combined", "opposed"].includes(session.rollType)) return true;
        return session.participants.every((entry) => RollVisibilityPolicy.canViewParticipantRoll(entry, session));
    }
}
