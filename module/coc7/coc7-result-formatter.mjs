import { COC7_MODULE_ID } from "./coc7-settings.mjs";

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
}
