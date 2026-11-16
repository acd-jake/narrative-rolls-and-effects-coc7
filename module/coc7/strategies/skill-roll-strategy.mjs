import { SessionStore } from "../../core-bridge.mjs";
import { BasicRollStrategy } from "./basic-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";

/**
 * Strategy for Call of Cthulhu 7e Skill, Characteristic, and Luck checks.
 * Opens SkillCheckPromptApp and automatically marks Skill items for improvement upon success.
 */
export class SkillRollStrategy extends BasicRollStrategy {
  /** @override */
  renderPrompt(options) {
    new (getPromptApp("skill"))(options).render(true);
  }

  /** @override */
  async onRollApplied(participant, state) {
    await super.onRollApplied(participant, state);
    if (!participant?.isSuccess || !participant?.itemId) return;

    const actor =
      SessionStore.resolveActor(participant);
    const item = actor?.items.get(participant.itemId);

    if (item?.type === "skill" && !item.system.flags?.developement) {
      await item.update({ "system.flags.developement": true });
    }
  }
}
