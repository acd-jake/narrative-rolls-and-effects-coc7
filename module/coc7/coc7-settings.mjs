export const COC7_MODULE_ID = "narrative-rolls-and-effects-coc7";

export class CoC7Settings {
    static register() {
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
    }
}
