export function createSkillCheckPromptApp(core, BasicPromptApp) {
    const ParentPromptApp = core.extendPromptClass(BasicPromptApp, {
        template: "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/basic-roll-prompt.hbs"
    });
    return class SkillCheckPromptApp extends ParentPromptApp {
    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.session;
        const p = sys?.participants?.[0];

        const difficulty = sys?.difficulty || "regular";
        const baseTarget = Number(p?.targetValue ?? 0);
        const effectiveTarget = this._getDifficultyThreshold(baseTarget, difficulty);

        return {
            ...context,
            displayTarget: effectiveTarget,
            difficulty: game.i18n.localize(`ROE_COC7.Difficulty.${difficulty.capitalize()}`)
        };
        };
    }
}
