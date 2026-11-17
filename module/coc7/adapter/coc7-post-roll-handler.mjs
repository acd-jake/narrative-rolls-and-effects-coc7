import { RollVisibilityPolicy, SessionStore, UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/** Evaluates and executes post-roll Luck and pushed-check decisions. */
export class CoC7PostRollHandler {

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
            if (!actor || currentLuck < cost) return null;
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
                p.key === participantKey ? { ...p, luckDecided: true } : p
            );
            return { session: { ...session, participants }, finalize: true };
        }
        if (actionId === "pushRoll") {
            const participants = CoC7CheckResolver.buildPushedParticipants(session, participantKey, payload.rollData);
            if (!participants) return null;
            return { session: { ...session, participants }, finalize: true };
        }
        return null;
    }

    /** Calculates which Luck and push actions the current user may take for a rolled participant. */
    evaluateParticipantOptions(participant, session, isDelegatedToPlayer) {
        if (!participant?.hasRolled || session.isResolved || session.rollType === "other") {
            return { canSpendLuck: false, luckCost: 0, luckTargetLevel: "", luckTargetLabel: "", canPush: false, hasPendingAction: false, isDelegatedToPlayer };
        }
        const actor = SessionStore.resolveActor(participant);
        if (!actor || (!game.user.isGM && !actor.isOwner)) {
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
        return {
            canSpendLuck,
            luckCost,
            luckTargetLevel,
            luckTargetLabel: luckTargetLevel ? game.i18n.localize(`ROE_COC7.SuccessLevels.${luckTargetLevel}`) : "",
            canPush,
            hasPendingAction: canSpendLuck || canPush,
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

    /** Confirms, rolls, and submits a participant's pushed check from a prompt action. */
    async pushRoll(prompt, target) {
        const session = prompt.session;
        const key = target.dataset.key || session?.participants?.[0]?.key;
        const participant = session?.participants?.find((entry) => entry.key === key);
        if (!participant || !this.evaluateParticipantOptions(participant, session, false).canPush) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("ROE_COC7.Roll.PushWarningTitle") },
            content: `<p>${game.i18n.localize("ROE_COC7.Roll.PushWarning")}</p>`,
            yes: { label: game.i18n.localize("ROE_COC7.Roll.PushRoll") },
            no: { label: game.i18n.localize("ROE_COC7.Roll.PushCancel") },
            rejectClose: false
        });
        if (!confirmed) return;
        const rollData = await this.executePushRoll(session, key);
        if (rollData) {
            await UniversalRollOrchestrator.executePostRollAction(prompt._messageId, key, "pushRoll", { rollData });
        }
    }
}
