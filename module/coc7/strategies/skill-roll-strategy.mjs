import { MODULE_ID, SessionStore } from "../../core-bridge.mjs";
import { BasicRollStrategy } from "./basic-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/**
 * Strategy for Call of Cthulhu 7e Skill, Characteristic, Luck, and automatic CON/INT checks.
 * Opens SkillCheckPromptApp, marks skills for improvement, and applies wound or insanity conditions.
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
            await this.#handleSpecialConsequence(state, participant, !participant.isSuccess);
            return;
        }

        if (state.isBoutIntCheck) {
            await this.#handleSpecialConsequence(state, participant, Boolean(participant.isSuccess));
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
        if (!participant?.hasRolled) return;

        if (state.isConCheck && !participant.isSuccess) {
            await this.#applyConCheckConsequence(state, participant);
        } else if (state.isBoutIntCheck && participant.isSuccess) {
            await this.#applyBoutIntConsequence(state, participant);
        }
    }

    /** @override */
    evaluateResolution(state) {
        const base = super.evaluateResolution(state);
        const participant = state.participants?.at(0);
        if (!participant?.hasRolled || !state.consequenceApplied) return base;

        if (state.isConCheck && !participant.isSuccess) {
            const noteKey = state.stayAlive
                ? "ROE_COC7.RollSession.ConCheckDead"
                : "ROE_COC7.RollSession.ConCheckUnconscious";
            const note = game.i18n.format(noteKey, { name: participant.actorName });
            return {
                ...base,
                outcomeHeadline: base.outcomeHeadline ? `${base.outcomeHeadline} – ${note}` : note
            };
        }

        if (state.isBoutIntCheck && participant.isSuccess) {
            const note = game.i18n.format("ROE_COC7.Sanity.TemporaryInsanitySummary", {
                hours: state.tempInsanityHours ?? 1,
                rounds: state.boutDurationRounds ?? 1
            });
            return {
                ...base,
                outcomeHeadline: base.outcomeHeadline ? `${base.outcomeHeadline} – ${note}` : note
            };
        }

        return base;
    }

    async #handleSpecialConsequence(state, participant, triggered) {
        if (!triggered || state.consequenceApplied) return;
        const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));
        if (autoApply) {
            await this.applyConsequences(state);
        } else {
            state.hasPendingConsequences = true;
        }
    }

    async #applyConCheckConsequence(state, participant) {
        if (state.consequenceApplied) return;
        const actor = SessionStore.resolveActor(participant);
        const condition = state.stayAlive ? "dead" : "unconscious";
        await CoC7DataMapper.setCondition(actor, condition, true);
        state.consequenceApplied = true;
        state.hasPendingConsequences = false;
    }

    async #applyBoutIntConsequence(state, participant) {
        if (state.consequenceApplied) return;
        const hoursRoll = await new Roll("1d10").evaluate();
        const roundsRoll = await new Roll("1d10").evaluate();
        state.tempInsanityHours = hoursRoll.total;
        state.boutDurationRounds = roundsRoll.total;

        const actor = SessionStore.resolveActor(participant);
        await CoC7DataMapper.setCondition(actor, "temporaryInsanity", true);
        state.consequenceApplied = true;
        state.hasPendingConsequences = false;
    }
}
