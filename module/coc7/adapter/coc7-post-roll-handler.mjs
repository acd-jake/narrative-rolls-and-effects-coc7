import { RollVisibilityPolicy, SessionStore, UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";
import { CoC7PushConsequenceService } from "./coc7-push-consequence-service.mjs";

/** Evaluates and executes post-roll Luck and pushed-check decisions. */
export class CoC7PostRollHandler {

    static #activePushConfirmations = new Set();

    /** Rolls and packages a participant's pushed check for submission by the core orchestrator. */
    async executePushRoll(session, participantKey) {
        if (!CoC7CheckResolver.canPush(session, participantKey)) return null;
        const participant = session.participants.find((p) => p.key === participantKey);
        const modifierDice = Number(participant.modifierDice ?? 0);
        const roll = await new Roll(CoC7CheckResolver.buildRollFormula(modifierDice)).evaluate();
        return {
            total: roll.total === 0 ? 100 : roll.total,
            modifierDice,
            rollMode: RollVisibilityPolicy.getCurrentRollMode(),
            rollerUserId: game.user.id,
            rollBreakdown: CoC7CheckResolver.buildBreakdown(roll, 0, "", { modifierDice })
        };
    }

    /** Applies a participant's Luck, decline, or pushed-roll choice to the session. */
    async handlePostRollAction(session, participantKey, actionId, payload) {
        if (actionId === "spendLuck") {
            const target = session.participants.find((p) => p.key === participantKey);
            if (!target || target.isPushed) return null;
            const actor = SessionStore.resolveActor(target);
            const currentLuck = CoC7DataMapper.getResource(actor, "luck")?.value ?? 0;
            const cost = Number(payload.cost);
            if (!actor || actor.type !== "character" || currentLuck < cost) return null;
            const remainingLuck = currentLuck - cost;
            await actor.update({ "system.attribs.lck.value": remainingLuck });
            const rank = CoC7CheckResolver.LEVEL_RANK;
            const isSuccess = (rank[payload.newLevel] ?? 0) >= (rank[session.difficulty] ?? 2);
            const canUpgradeMore = this.#canUpgradeFurther(target.total, target.targetValue, payload.newLevel, remainingLuck);
            const participants = session.participants.map((participant) =>
                this.#updateLuckParticipant(participant, participantKey, payload.newLevel, isSuccess, cost, canUpgradeMore)
            );
            return { session: { ...session, participants }, finalize: true };
        }
        if (actionId === "declineLuck") {
            const participants = session.participants.map((p) =>
                p.key === participantKey || session.rollType === "combined"
                    ? { ...p, luckDecided: true, pushDecided: true }
                    : p
            );
            return {
                session: {
                    ...session,
                    participants,
                    pushConsequenceRequest: null,
                    pushConsequenceReady: false
                },
                finalize: true
            };
        }
        if (actionId === "pushRoll") {
            const participants = CoC7CheckResolver.buildPushedParticipants(session, participantKey, payload.rollData);
            if (!participants) return null;
            return {
                session: {
                    ...session,
                    participants,
                    pushConsequenceRequest: null
                },
                finalize: true
            };
        }
        return null;
    }

    /** Calculates which Luck and push actions the current user may take for a rolled participant. */
    evaluateParticipantOptions(participant, session, isDelegatedToPlayer) {
        if (!participant?.hasRolled || session.isResolved || ["other", "combat", "ranged"].includes(session.rollType)) {
            return { canSpendLuck: false, luckCost: 0, luckTargetLevel: "", luckTargetLabel: "", canPush: false, hasPendingAction: false, isDelegatedToPlayer };
        }

        const actor = SessionStore.resolveActor(participant);
        if (!actor || actor.type !== "character" || (!game.user.isGM && !actor.isOwner)) {
            return { canSpendLuck: false, luckCost: 0, luckTargetLevel: "", luckTargetLabel: "", canPush: false, hasPendingAction: false, isDelegatedToPlayer };
        }
        const level = participant.successLevel;
        const isPushed = Boolean(participant.isPushed);
        const availableLuck = CoC7DataMapper.getResource(actor, "luck")?.value ?? 0;
        let luckCost = 0;
        let luckTargetLevel = "";
        // Luck can improve a failure to the required level or advance an allowed success by one level.
        if (!participant.luckDecided && !isPushed && level !== "fumble" && level !== "critical" && availableLuck > 0) {
            const allowImprove = this.#isLuckImprovementAllowed();
            let desiredLevel = "";
            if (!participant.isSuccess) desiredLevel = session.difficulty || "regular";
            else if (allowImprove) {
                if (level === "regular") desiredLevel = "hard";
                else if (level === "hard") desiredLevel = "extreme";
            }
            if (desiredLevel) {
                const threshold = this.#getDifficultyThreshold(participant.targetValue, desiredLevel);
                const needed = participant.total - threshold;
                if (needed > 0 && needed <= availableLuck) {
                    luckCost = needed;
                    luckTargetLevel = desiredLevel;
                }
            }
        }
        const canPush = CoC7CheckResolver.canPush(session, participant.key);
        const canSpendLuck = luckCost > 0;
        const declinePostRollLabel = canSpendLuck && canPush
            ? game.i18n.localize("ROE_COC7.RollSession.DeclineLuckAndPushBtn")
            : canSpendLuck
                ? game.i18n.localize("ROE_COC7.RollSession.DeclineLuckBtn")
                : canPush
                    ? game.i18n.localize("ROE_COC7.RollSession.DeclinePushBtn")
                    : "";

        return {
            canSpendLuck,
            luckCost,
            luckTargetLevel,
            luckTargetLabel: luckTargetLevel ? game.i18n.localize(`ROE_COC7.SuccessLevels.${luckTargetLevel}`) : "",
            canPush,
            hasPendingAction: canSpendLuck || canPush,
            declinePostRollLabel,
            isDelegatedToPlayer
        };
    }

    #updateLuckParticipant(participant, participantKey, newLevel, isSuccess, cost, canUpgradeMore) {
        if (participant.key !== participantKey) return participant;
        return {
            ...participant,
            successLevel: newLevel,
            isSuccess,
            luckSpent: (participant.luckSpent ?? 0) + cost,
            luckDecided: !canUpgradeMore
        };
    }

    #getDifficultyThreshold(target, difficulty) {
        if (difficulty === "hard") return Math.floor(target / 2);
        if (difficulty === "extreme") return Math.floor(target / 5);
        return target;
    }

    #isLuckImprovementAllowed() {
        for (const key of ["spendLuck", "luckImprovement", "allowLuckImprovement"]) {
            if (game.settings?.settings.has(`CoC7.${key}`)) {
                return Boolean(game.settings.get("CoC7", key));
            }
        }
        return false;
    }

    #canUpgradeFurther(total, targetValue, currentLevel, remainingLuck) {
        if (remainingLuck <= 0 || !this.#isLuckImprovementAllowed()) return false;
        const nextThreshold = currentLevel === "regular"
            ? Math.floor(targetValue / 2)
            : currentLevel === "hard"
                ? Math.floor(targetValue / 5)
                : null;
        if (nextThreshold === null) return false;
        const needed = total - nextThreshold;
        return needed > 0 && needed <= remainingLuck;
    }

    /** Submits the selected Luck expenditure from a prompt action. */
    async handleSpendLuck(prompt, target) {
        const key = target.dataset.key || prompt.session?.participants?.[0]?.key;
        const cost = Number(target.dataset.cost);
        const newLevel = target.dataset.level;
        if (!key || !cost || !newLevel) return;
        await UniversalRollOrchestrator.executePostRollAction(prompt._messageId, key, "spendLuck", { cost, newLevel });
    }

    /** Submits a participant's decision to decline further Luck spending. */
    async handleDeclineLuck(prompt, target) {
        const key = target.dataset.key || prompt.session?.participants?.[0]?.key;
        if (key) await UniversalRollOrchestrator.executePostRollAction(prompt._messageId, key, "declineLuck");
    }

    /** Handles initiating or confirming a pushed check, including Keeper consequence selection. */
    async pushRoll(prompt, target) {
        const session = prompt.session;
        const messageId = prompt._messageId;
        const key = target.dataset.key || session?.participants?.[0]?.key;
        const participant = session?.participants?.find((entry) => entry.key === key);
        if (!participant || !this.evaluateParticipantOptions(participant, session, false).canPush) return;

        const showForeshadowing = Boolean(game.settings?.get?.(COC7_MODULE_ID, "showPushForeshadowingToPlayers"));
        const isReady = Boolean(session.pushConsequenceReady);

        // When foreshadowing is shown to players, request Keeper selection first before showing the warning.
        if (showForeshadowing && !isReady) {
            if (!session.pushConsequenceRequest) {
                await this.#requestKeeperConsequence(messageId, participant);
            }
            return;
        }

        // When foreshadowing is hidden from players, notify the Keeper to select stakes in parallel while showing the warning immediately.
        if (!showForeshadowing && !isReady && !session.pushConsequenceRequest && !session.pushConsequence) {
            await this.#requestKeeperConsequence(messageId, participant);
        }

        if (CoC7PostRollHandler.#activePushConfirmations.has(messageId)) return;
        CoC7PostRollHandler.#activePushConfirmations.add(messageId);

        let confirmed = false;
        try {
            const warningContent = await this.#buildPushWarningHtml(session, showForeshadowing);
            confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize("ROE_COC7.Roll.PushWarningTitle") },
                content: warningContent,
                yes: { label: game.i18n.localize("ROE_COC7.Roll.PushRoll") },
                no: { label: game.i18n.localize("ROE_COC7.Roll.PushCancel") },
                rejectClose: false
            });
        } finally {
            CoC7PostRollHandler.#activePushConfirmations.delete(messageId);
        }
        if (!confirmed) return;

        const rollData = await this.executePushRoll(session, key);
        if (rollData) {
            await UniversalRollOrchestrator.executePostRollAction(messageId, key, "pushRoll", { rollData });
        }
    }
    /** Reads the Keeper's selected or custom consequence from the prompt and releases the push warning. */
    async confirmPushConsequence(prompt) {
        if (!game.user.isGM) return;
        const session = prompt.session;
        const request = session?.pushConsequenceRequest;
        const root = prompt.element;
        if (!request || !root) return;

        const isInsane = Boolean(root.querySelector("[name='pushConsequenceInsane']")?.checked);
        const mode = root.querySelector("[name='pushConsequenceSelect']")?.value ?? "__none__";
        const participant = session.participants?.find((p) => p.key === request.participantKey) ?? session.participants?.at(0);

        let consequence = null;
        if (mode === "__custom__") {
            const title = root.querySelector("[name='customConsequenceTitle']")?.value?.trim() || game.i18n.localize("ROE_COC7.Roll.PushFailureTitle");
            const description = root.querySelector("[name='customConsequenceDescription']")?.value?.trim() ?? "";
            const narration = root.querySelector("[name='customConsequenceNarration']")?.value?.trim() ?? "";
            const foreshadowing = root.querySelector("[name='customConsequenceForeshadowing']")?.value?.trim() ?? "";
            if (description || narration || foreshadowing) {
                consequence = { title, description, narration, foreshadowing, insane: isInsane };
            }
        } else if (mode !== "__none__") {
            const presets = CoC7PushConsequenceService.getSkillConsequences(participant, isInsane);
            const chosen = presets[Number(mode)];
            if (chosen) {
                consequence = {
                    title: chosen.title,
                    description: chosen.description,
                    narration: chosen.narration,
                    foreshadowing: chosen.foreshadowing,
                    insane: Boolean(chosen.insane)
                };
            }
        }

        await UniversalRollOrchestrator.updateSessionPatch(prompt._messageId, {
            pushConsequence: consequence,
            pushConsequenceRequest: null,
            pushConsequenceReady: true
        });
    }

    async #requestKeeperConsequence(messageId, participant) {
        const actor = SessionStore.resolveActor(participant);
        const isInsane = CoC7PushConsequenceService.isActorInsane(actor);
        const presets = CoC7PushConsequenceService.getSkillConsequences(participant, isInsane);
        await UniversalRollOrchestrator.updateSessionPatch(messageId, {
            pushConsequenceRequest: {
                participantKey: participant.key,
                isInsane,
                selectedMode: presets.length > 0 ? "0" : "__none__",
                customTitle: "",
                customDescription: "",
                customNarration: "",
                customForeshadowing: ""
            }
        });
    }

    async #buildPushWarningHtml(session, showForeshadowing) {
        const baseText = `<p>${game.i18n.localize("ROE_COC7.Roll.PushWarning")}</p>`;
        const foreshadowing = session?.pushConsequence?.foreshadowing;
        if (!showForeshadowing || !foreshadowing) return baseText;

        const header = game.i18n.localize("ROE_COC7.Roll.PushForeshadowingHeader");
        const enriched = await CoC7PushConsequenceService.enrichHtml(foreshadowing, { secrets: Boolean(game.user?.isGM) });
        return `<div class="prompt-phase-summary"><div class="section-header">${header}</div><div class="push-foreshadowing-text">${enriched}</div></div>${baseText}`;
    }
}
