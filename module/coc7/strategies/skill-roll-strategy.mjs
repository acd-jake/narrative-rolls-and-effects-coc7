import { MODULE_ID, SessionStore } from "../../core-bridge.mjs";
import { BasicRollStrategy } from "./basic-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

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
        if (!participant?.hasRolled) return;

        if (state.isConCheck) {
            if (!participant.isSuccess && !state.consequenceApplied) {
                const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
                if (autoApply) {
                    await this.#applyConCheckConsequence(state, participant);
                } else {
                    state.hasPendingConsequences = true;
                }
            }
            return;
        }

        if (!participant.isSuccess || !participant.itemId) return;

        const actor = SessionStore.resolveActor(participant);
        const item = actor?.items.get(participant.itemId);

        if (item?.type === "skill" && !item.system.flags?.developement) {
            await item.update({ "system.flags.developement": true });
        }
    }

    /** @override */
    async applyConsequences(state) {
        const participant = state.participants?.at(0);
        if (state.isConCheck && participant && !participant.isSuccess) {
            await this.#applyConCheckConsequence(state, participant);
        }
    }

    /** @override */
    evaluateResolution(state) {
        const base = super.evaluateResolution(state);
        const participant = state.participants?.at(0);
        if (state.isConCheck && participant && !participant.isSuccess && state.consequenceApplied) {
            const noteKey = state.stayAlive
                ? "ROE_COC7.RollSession.ConCheckDead"
                : "ROE_COC7.RollSession.ConCheckUnconscious";
            const note = game.i18n.format(noteKey, { name: participant.actorName });
            return {
                ...base,
                outcomeHeadline: base.outcomeHeadline ? `${base.outcomeHeadline} – ${note}` : note
            };
        }
        return base;
    }

    async #applyConCheckConsequence(state, participant) {
        if (state.consequenceApplied) return;
        const actor = SessionStore.resolveActor(participant);
        const condition = state.stayAlive ? "dead" : "unconscious";
        await CoC7DataMapper.setCondition(actor, condition, true);
        state.consequenceApplied = true;
        state.hasPendingConsequences = false;
    }
}
