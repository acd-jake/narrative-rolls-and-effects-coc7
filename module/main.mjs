import { CoC7Adapter } from "./coc7/coc7-adapter.mjs";
import { setCoreApi } from "./core-bridge.mjs";
import { COC7_MODULE_ID, CoC7Settings } from "./coc7/coc7-settings.mjs";

// Register settings when Foundry starts.
Hooks.once("init", () => CoC7Settings.register());

// Set up the CoC7 integration when the core module registers its adapters.
Hooks.once("nre.registerAdapters", async (core) => {
    setCoreApi(core);
    core.registerAdapter("CoC7", new CoC7Adapter());

    // Load prompt partials used by the adapter for roll preparation and results.
    await foundry.applications.handlebars.loadTemplates({
        roePromptLayout: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/prompt-layout.hbs`,
        roeCocModifierPreparationHeader: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/modifier-preparation-header.hbs`,
        roeCocModifierPreparationDetails: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/modifier-preparation-details.hbs`,
        roeCocResolvedSingleHeader: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/resolved-single-header.hbs`,
        roeCocResolvedSingleBody: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/resolved-single-body.hbs`,
        roeCocResolvedOpposedBody: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/resolved-opposed-body.hbs`,
        roeCocResolvedSanityBody: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/resolved-sanity-body.hbs`,
        roeCocResolvedCombatBody: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/resolved-combat-body.hbs`,
        roePushFailurePhase: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/push-failure-phase.hbs`,
        roeSkillDifficultyControls: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/skill-difficulty-controls.hbs`,
        roeSanityLossControls: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/sanity-loss-controls.hbs`,
        roeResultSanity: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/result-sanity.hbs`,
        roeResultCombat: `modules/${COC7_MODULE_ID}/templates/core/prompts/partials/result-combat.hbs`
    });
});
