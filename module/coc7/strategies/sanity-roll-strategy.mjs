import { MODULE_ID } from "../../core-bridge.mjs";
import { CoC7SessionFactory } from "../coc7-session-factory.mjs";
import { BasicRollStrategy } from "./basic-roll-strategy.mjs";
import { getPromptApp } from "../prompts/prompt-app-registry.mjs";
import { SessionStore } from "../../core-bridge.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/** Resolves Sanity loss, threshold-based insanity, and any required Intelligence follow-up. */
export class SanityRollStrategy extends BasicRollStrategy {
    /** @override */
    renderPrompt(options) {
        new (getPromptApp("sanity"))(options).render(true);
    }

    /** @override */
    async onRollApplied(participant, state) {
        if (!participant?.hasRolled) return [];

        const actor =
            SessionStore.resolveActor(participant);
        if (!actor) return [];

        const autoApply = Boolean(game.settings?.get(MODULE_ID, "autoApplyRollConsequences"));

        // STEP 3: Follow-up INT check ("insanityInt") evaluated
        if (participant.key === "insanityInt") {
            if (participant.isSuccess) {
                const hoursRoll = await new Roll("1d10").evaluate();
                const roundsRoll = await new Roll("1d10").evaluate();

                state.tempInsanityHours = hoursRoll.total;
                state.boutDurationRounds = roundsRoll.total;
            }

            if (autoApply && !state.consequencesApplied) {
                await this.applyConsequences(state);
                state.consequencesApplied = true;
                state.hasPendingConsequences = false;
            } else if (!state.consequencesApplied) {
                state.hasPendingConsequences = true;
            }
            return [];
        }

        // STEP 1 & 2: Initial Sanity roll ("p0")
        if (participant.key !== "p0" || state.sanityLost != null) return [];

        const isFumble = participant.successLevel === "fumble";
        const rawFormula = isFumble
            ? state.sanityLossFailure || "1d6"
            : participant.isSuccess
                ? state.sanityLossSuccess || "0"
                : state.sanityLossFailure || "1d6";

        let lost = 0;
        if (rawFormula && rawFormula !== "0") {
            const lossRoll = new Roll(rawFormula);
            if (isFumble) {
                await lossRoll.evaluate({ maximize: true });
            } else {
                await lossRoll.evaluate();
            }
            lost = Math.max(0, lossRoll.total);
        }

        const sanResource = CoC7DataMapper.getResource(actor, "sanity") ?? {};
        const currentSan = Number(sanResource.value ?? 0);
        const previousDailyLoss = Number(sanResource.dailyLoss ?? 0);

        // Reconstruct the day's starting Sanity to test the cumulative one-fifth threshold.
        const dailyStartSan = currentSan + previousDailyLoss;
        const newSan = Math.max(0, currentSan - lost);
        const newDailyLoss = previousDailyLoss + lost;
        const twentyPercentThreshold = Math.floor(dailyStartSan / 5);

        const isPermanent = lost > 0 && newSan === 0;
        const triggersIndefinite =
            lost > 0 &&
            !isPermanent &&
            twentyPercentThreshold > 0 &&
            newDailyLoss >= twentyPercentThreshold;
        const triggersBout = lost >= 5 && !isPermanent && !triggersIndefinite;

        state.sanityLost = lost;
        state.sanityPermanentInsanity = isPermanent;
        state.sanityTriggersIndefinite = triggersIndefinite;
        state.sanityTriggersBout = triggersBout;

        const hasConsequences = lost > 0 || isPermanent || triggersIndefinite;

        // If an INT check is needed, wait until the INT check finishes before applying consequences
        const alreadyHasIntCheck = state.participants?.some((p) => p.key === "insanityInt");
        if (triggersBout && !alreadyHasIntCheck) {
            state.hasPendingConsequences = !autoApply;
            const intValue = Number(actor.system?.characteristics?.int?.value ?? 50);
            return [
                {
                    ...SessionStore.buildParticipant(
                        "insanityInt",
                        actor,
                        game.i18n.localize("ROE_COC7.Sanity.TemporaryInsanityIntCheck"),
                        intValue
                    ),
                    diceFormula: "1d100",
                    isFollowUp: true
                }
            ];
        }

        if (hasConsequences) {
            if (autoApply) {
                await this.applyConsequences(state);
                state.consequencesApplied = true;
                state.hasPendingConsequences = false;
            } else {
                state.hasPendingConsequences = true;
            }
        } else {
            state.consequencesApplied = true;
            state.hasPendingConsequences = false;
        }

        return [];
    }

    /** @override */
    async applyConsequences(state) {
        const sanRoll = state.participants?.find((p) => p.key === "p0") ?? state.participants?.at(0);
        if (!sanRoll) return;

        const actor =
            SessionStore.resolveActor(sanRoll);
        if (!actor) return;

        const lost = Number(state.sanityLost ?? 0);
        const sanResource = CoC7DataMapper.getResource(actor, "sanity") ?? {};
        const currentSan = Number(sanResource.value ?? 0);
        const previousDailyLoss = Number(sanResource.dailyLoss ?? 0);

        if (lost > 0) {
            const updates = {
                "system.attribs.san.value": Math.max(0, currentSan - lost),
                "system.attribs.san.dailyLoss": previousDailyLoss + lost
            };
            await actor.update(updates, { nreSanityHandled: true });
        }

        const intRoll = state.participants?.find((p) => p.key === "insanityInt");
        if (state.sanityPermanentInsanity || state.sanityTriggersIndefinite) {
            await CoC7DataMapper.setCondition(actor, "indefiniteInsanity", true);
        } else if (intRoll?.hasRolled && intRoll?.isSuccess) {
            await CoC7DataMapper.setCondition(actor, "temporaryInsanity", true);
        }
    }

    /** @override */
    evaluateResolution(state) {
        const base = super.evaluateResolution(state);
        const { sanitySummaryText } = CoC7SessionFactory.enrichForTemplate(state);

        return {
            winnerKey: base.winnerKey,
            outcomeHeadline: sanitySummaryText || base.outcomeHeadline
        };
    }
}
