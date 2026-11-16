import { createBasicRollPromptApp } from "./basic-roll-prompt-app.mjs";
import { createSkillCheckPromptApp } from "./skill-check-prompt-app.mjs";
import { createCombinedRollPromptApp } from "./combined-roll-prompt-app.mjs";
import { createOpposedRollPromptApp } from "./opposed-roll-prompt-app.mjs";
import { createCombatPromptApp } from "./combat-prompt-app.mjs";
import { createRangedPromptApp } from "./ranged-prompt-app.mjs";
import { createSanityCheckPromptApp } from "./sanity-check-prompt-app.mjs";
import { registerPromptApps } from "./prompt-app-registry.mjs";

export function initializePromptApps(core) {
    const basic = createBasicRollPromptApp(core);
    const opposed = createOpposedRollPromptApp(core);
    registerPromptApps({
        basic,
        skill: createSkillCheckPromptApp(core, basic),
        combined: createCombinedRollPromptApp(core),
        opposed,
        combat: createCombatPromptApp(core, opposed),
        ranged: createRangedPromptApp(core, basic),
        sanity: createSanityCheckPromptApp(core, basic)
    });
}
