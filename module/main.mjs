import { CoC7Adapter } from "./coc7/coc7-adapter.mjs";
import { setCoreApi } from "./core-bridge.mjs";
import { COC7_MODULE_ID, CoC7Settings } from "./coc7/coc7-settings.mjs";

Hooks.once("init", () => CoC7Settings.register());

Hooks.once("nre.registerAdapters", async (core) => {
    setCoreApi(core);
    core.registerAdapter("CoC7", new CoC7Adapter());

    await foundry.applications.handlebars.loadTemplates({
        roePromptLayout: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/prompt-layout.hbs`,
        roeDiceDisplay: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/dice-display.hbs`,
        roePushFailurePhase: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/push-failure-phase.hbs`,
        roeSkillDifficultyControls: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/skill-difficulty-controls.hbs`,
        roeSanityLossControls: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/sanity-loss-controls.hbs`,
        roeResultSanity: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/result-sanity.hbs`,
        roeResultCombat: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/result-combat.hbs`
    });
});
