import { createPushConsequenceEditor } from "./push-consequence-editor.mjs";
import { PUSH_CONSEQUENCES_SETTING } from "./coc7-constants.mjs";

export const COC7_MODULE_ID = "narrative-rolls-and-effects-coc7";

/** Registers client and world preferences for CoC7 rolls. */
export class CoC7Settings {
    /** Registers the module settings and configuration menus. */
    static register() {

        game.settings.register(COC7_MODULE_ID, "interceptSystemRolls", {
            name: "ROE_COC7.Settings.InterceptSystemRolls.Name",
            hint: "ROE_COC7.Settings.InterceptSystemRolls.Hint",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(COC7_MODULE_ID, PUSH_CONSEQUENCES_SETTING, {
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });
        game.settings.registerMenu(COC7_MODULE_ID, "pushConsequenceEditor", {
            name: "ROE_COC7.PushEditor.Title",
            label: "ROE_COC7.PushEditor.Open",
            hint: "ROE_COC7.PushEditor.Hint",
            icon: "fa-solid fa-book-open",
            type: createPushConsequenceEditor(),
            restricted: true
        });
        game.settings.register(COC7_MODULE_ID, "resultDisplayMode", {
            name: "ROE_COC7.Settings.ResultDisplayMode.Name",
            hint: "ROE_COC7.Settings.ResultDisplayMode.Hint",
            scope: "world",
            config: true,
            type: String,
            choices: {
                both: "ROE_COC7.Settings.ResultDisplayMode.Both",
                numbers: "ROE_COC7.Settings.ResultDisplayMode.Numbers",
                level: "ROE_COC7.Settings.ResultDisplayMode.Level"
            },
            default: "both"
        });

        game.settings.register(COC7_MODULE_ID, "successLevelFormat", {
            name: "ROE_COC7.Settings.SuccessLevelFormat.Name",
            hint: "ROE_COC7.Settings.SuccessLevelFormat.Hint",
            scope: "world",
            config: true,
            type: String,
            choices: {
                text: "ROE_COC7.Settings.SuccessLevelFormat.Text",
                symbols: "ROE_COC7.Settings.SuccessLevelFormat.Symbols"
            },
            default: "text"
        });

        game.settings.register(COC7_MODULE_ID, "sanityEvaluationHints", {
            name: "ROE_COC7.Settings.SanityEvaluationHints.Name",
            hint: "ROE_COC7.Settings.SanityEvaluationHints.Hint",
            scope: "world",
            config: true,
            type: new foundry.data.fields.StringField({
                required: false,
                blank: true,
                initial: ""
            }),
            default: "",
            input: (field, config) => {
                const value = config.value || game.i18n.localize("ROE_COC7.Settings.SanityEvaluationHints.Default");
                return foundry.applications.fields.createTextareaInput({
                    ...config,
                    value,
                    rows: 5
                });
            }
        });

        Hooks.once("i18nInit", () => {
            const setting = game.settings.settings.get(`${COC7_MODULE_ID}.sanityEvaluationHints`);
            if (setting) {
                const defaultHints = game.i18n.localize("ROE_COC7.Settings.SanityEvaluationHints.Default");
                setting.default = defaultHints;
                if (setting.type) setting.type.initial = defaultHints;
            }
        });

        game.settings.register(COC7_MODULE_ID, "combatResolvedLayout", {
            name: "ROE_COC7.Settings.CombatResolvedLayout.Name",
            hint: "ROE_COC7.Settings.CombatResolvedLayout.Hint",
            scope: "world",
            config: true,
            type: String,
            choices: {
                narrative: "ROE_COC7.Settings.CombatResolvedLayout.Narrative",
                duel: "ROE_COC7.Settings.CombatResolvedLayout.Duel"
            },
            default: "narrative"
        });

        game.settings.register(COC7_MODULE_ID, "automaticRangedDamage", {
            name: "ROE_COC7.Settings.AutomaticRangedDamage.Name",
            hint: "ROE_COC7.Settings.AutomaticRangedDamage.Hint",
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });
        game.settings.register(COC7_MODULE_ID, "rangedDamageRollPolicy", {
            name: "ROE_COC7.Settings.RangedDamageRollPolicy.Name",
            hint: "ROE_COC7.Settings.RangedDamageRollPolicy.Hint",
            scope: "world",
            config: true,
            type: String,
            choices: {
                client: "ROE_COC7.Settings.RangedDamageRollPolicy.Client",
                automatic: "ROE_COC7.Settings.RangedDamageRollPolicy.Automatic",
                manual: "ROE_COC7.Settings.RangedDamageRollPolicy.Manual"
            },
            default: "client"
        });
    }

    /** Returns whether the current client should automatically roll ranged damage. */
    static shouldAutoRollRangedDamage() {
        const policy = game.settings.get(COC7_MODULE_ID, "rangedDamageRollPolicy");
        if (policy === "automatic") return true;
        if (policy === "manual") return false;
        return Boolean(game.settings.get(COC7_MODULE_ID, "automaticRangedDamage"));
    }

    /** Returns whether CoC7 system roll functions should be intercepted into NRE sessions. */
    static isSystemInterceptionEnabled() {
        if (!game.settings?.settings?.has?.(`${COC7_MODULE_ID}.interceptSystemRolls`)) return true;
        return Boolean(game.settings.get(COC7_MODULE_ID, "interceptSystemRolls"));
    }

}
