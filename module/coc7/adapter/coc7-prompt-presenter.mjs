import { RollVisibilityPolicy, UniversalRollOrchestrator } from "../../core-bridge.mjs";
import { COC7_MODULE_ID } from "../coc7-settings.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CoC7SessionFactory } from "../coc7-session-factory.mjs";
import { CoC7CombatResultPresenter } from "./coc7-combat-result-presenter.mjs";
import { CoC7PushConsequenceService } from "./coc7-push-consequence-service.mjs";

const PREPARATION_DIFFICULTIES = ["regular", "hard", "extreme"];
const DIFFICULTY_PREPARATION_ROLL_TYPES = new Set(["basic", "skill", "combined"]);
const SINGLE_ACTOR_RESOLVED_ROLL_TYPES = new Set(["basic", "skill", "other", "combined"]);

/** Prepares phase-aware prompt contexts, partials, and participant controls. */
export class CoC7PromptPresenter {
    #waitingHintsBySession = new Map();
    #dicePresenter;

    /** Creates the presenter with the dice-label formatter it collaborates with. */
    constructor(dicePresenter) {
        this.#dicePresenter = dicePresenter;
    }

    /** Returns participants shown in the modifier-preparation phase, or an empty list otherwise. */
    buildPreparationParticipants(session) {
        if (!session?.isPreparingModifiers || session.rollType === "other") return [];
        let participants = session.participants ?? [];
        if (session.rollType === "combined") participants = participants.slice(0, 1);
        if (session.rollType === "ranged") participants = participants.filter((participant) => participant.key === "attacker");
        return participants.map((participant) => this.#buildPreparationParticipant(participant, session));
    }

    /** Returns tactical modifier controls shown while preparing a combat or ranged roll. */
    buildPreparationTactics(session) {
        if (!session?.isPreparingModifiers) return [];
        if (session.rollType === "combat") {
            const labels = { outnumbered: "Outnumbered", surprised: "Surprised", proneTarget: "ProneTarget" };
            return Object.entries(labels).map((entry) => this.#buildPreparationTactic(entry, session));
        }
        if (session.rollType === "ranged") {
            const labels = {
                pointBlank: "PointBlank",
                cover: "Cover",
                fastTarget: "FastTarget",
                inMelee: "InMelee",
                proneTarget: "ProneTarget",
                smallTarget: "SmallTarget",
                largeTarget: "LargeTarget"
            };
            return Object.entries(labels).map((entry) => this.#buildPreparationTactic(entry, session));
        }
        return [];
    }

    /** Returns range-tier choices shown while preparing a ranged attack. */
    buildPreparationRanges(session) {
        if (!session?.isPreparingModifiers || session.rollType !== "ranged") return [];
        const current = session.rangedRangeTier || "normal";
        return ["normal", "long", "extreme"].map((tier) => ({
            value: tier,
            label: game.i18n.localize(`ROE_COC7.Ranged.Ranges.${tier.capitalize()}`),
            selected: current === tier
        }));
    }
    /** Adds push-failure visibility, push consequence controls, and resolved-result fields to a prompt context. */
    async preparePromptContext(prompt, session, context) {
        const pushedParticipants = (session?.participants ?? []).filter((participant) => participant.isPushed);
        const showForeshadowingToPlayers = Boolean(game.settings?.get?.(COC7_MODULE_ID, "showPushForeshadowingToPlayers"));
        const waitingForKeeperStakes = Boolean(
            !game.user?.isGM &&
            session?.pushConsequenceRequest &&
            showForeshadowingToPlayers &&
            !session?.pushConsequenceReady &&
            !session?.isResolved
        );
        const selectionCtx = await CoC7PushConsequenceService.buildKeeperSelectionContext(session);
        const displayCtx = await CoC7PushConsequenceService.buildDisplayContext(session);

        const base = {
            ...context,
            ...selectionCtx,
            ...displayCtx,
            waitingForKeeperStakes,
            showPushFailureWarning: Boolean(game.user.isGM && session?.pushFailurePending),
            canViewPushFailure: pushedParticipants.length > 0 && pushedParticipants.every((participant) =>
                RollVisibilityPolicy.canViewParticipantRoll(participant, session)
            ),
            preparationRanges: this.buildPreparationRanges(session),
        };
        if (!session?.isResolved) return base;
        if (SINGLE_ACTOR_RESOLVED_ROLL_TYPES.has(session.rollType)) {
            return { ...base, ...this.#buildResolvedSingleActorContext(session) };
        }
        if (session.rollType === "opposed") return { ...base, ...this.#buildResolvedOpposedContext(session) };
        if (session.rollType === "sanity") return { ...base, ...this.#buildResolvedSanityContext(session) };
        if (session.rollType === "combat" || session.rollType === "ranged") {
            return { ...base, ...CoC7CombatResultPresenter.buildResolvedContext(session) };
        }
        return base;
    }

    /** Builds the same visibility-aware resolved context for a chat card as for a prompt. */
    async prepareResolvedChatContext(session) {
        const allVisible = (session.participants ?? []).every((participant) =>
            RollVisibilityPolicy.canViewParticipantRoll(participant, session)
        );
        return this.preparePromptContext(null, session, {
            resolvedTitle: session.title ?? "",
            resolvedHeadline: allVisible ? session.outcomeHeadline ?? "" : ""
        });
    }

    /** Returns the registered partials to include during modifier preparation. */
    getModifierPreparationPartials(session) {
        if (!session?.isPreparingModifiers) return {};
        return {
            header: "roeCocModifierPreparationHeader",
            details: "roeCocModifierPreparationDetails"
        };
    }

    /** Returns the registered partials to include when displaying resolved checks. */
    getResolvedResultPartials(session) {
        if (!session?.isResolved) return {};
        const combatLayout = game.settings?.get(COC7_MODULE_ID, "combatResolvedLayout") || "narrative";
        const combatBody = combatLayout === "duel" ? "roeCocResolvedCombatDuel" : "roeCocResolvedCombatNarrative";
        const bodyByType = {
            basic: "roeCocResolvedSingleBody",
            skill: "roeCocResolvedSingleBody",
            other: "roeCocResolvedSingleBody",
            combined: "roeCocResolvedSingleBody",
            opposed: "roeCocResolvedOpposedBody",
            sanity: "roeCocResolvedSanityBody",
            combat: combatBody,
            ranged: combatBody
        };
        const body = bodyByType[session.rollType];
        return body ? { header: "roeCocResolvedSingleHeader", body } : {};
    }

    /** Returns a phase-aware waiting hint for players while the Keeper resolves the check. */
    getPlayerWaitingHint(session) {
        if (!session) return "";
        if (session.rollType === "sanity") {
            const cacheKey = `${session.initiatorUserId}:${session.title}:${session.participants?.at(0)?.actorId ?? ""}`;
            if (this.#waitingHintsBySession.has(cacheKey)) return this.#waitingHintsBySession.get(cacheKey);
            const configured = game.settings?.get(COC7_MODULE_ID, "sanityEvaluationHints")?.trim();
            const raw = configured || game.i18n.localize("ROE_COC7.Settings.SanityEvaluationHints.Default");
            const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            const chosen = lines.length
                ? lines[Math.floor(Math.random() * lines.length)]
                : game.i18n.localize("ROE.RollSession.AwaitingResolution");
            this.#waitingHintsBySession.set(cacheKey, chosen);
            return chosen;
        }
        if (session.rollType === "combat") {
            const attacker = session.participants?.find((p) => p.key === "attacker");
            const combatKey = session.combatPhase === "resolution"
                ? "ROE_COC7.RollSession.WaitingHints.combat"
                : !attacker?.hasRolled
                    ? "ROE_COC7.RollSession.WaitingHints.combatInitiator"
                    : "ROE_COC7.RollSession.WaitingHints.combatOpponent";
            return game.i18n.localize(combatKey);
        }
        if (session.rollType === "ranged") {
            const phase = session.combatPhase || "reaction";
            const rangedKey = phase === "reaction"
                ? "ROE_COC7.RollSession.WaitingHints.rangedReaction"
                : phase === "attack"
                    ? "ROE_COC7.RollSession.WaitingHints.rangedAttack"
                    : "ROE_COC7.RollSession.WaitingHints.ranged";
            return game.i18n.localize(rangedKey);
        }
        const key = `ROE_COC7.RollSession.WaitingHints.${session.rollType}`;
        return game.i18n.has(key) ? game.i18n.localize(key) : "";
    }

    /** Returns difficulty choices allowed in the current modifier-preparation phase. */
    buildPreparationDifficulties(session) {
        if (
            !session?.isPreparingModifiers ||
            session.canChangeDifficulty === false ||
            !DIFFICULTY_PREPARATION_ROLL_TYPES.has(session.rollType)
        ) return [];
        return PREPARATION_DIFFICULTIES.map((difficulty) => this.#buildPreparationDifficulty(difficulty, session));
    }

    /** Identifies participants whose modifier dice change together for the selected roll type. */
    getModifierParticipantKeys(session, participantKey) {
        return session.rollType === "combined"
            ? session.participants.map((participant) => participant.key)
            : [participantKey];
    }

    /** Routes prompt controls that update modifier-preparation state. */
    handlePreparationAction(prompt, actionName, target) {
        if (actionName === "togglePreparedTactical") return this.#togglePreparedTactical(prompt, target);
        if (actionName === "setPreparedDifficulty") return this.#setPreparedDifficulty(prompt, target);
        if (actionName === "setPreparedRangeTier") return this.#setPreparedRangeTier(prompt, target);
        return undefined;
    }

    #buildPreparationParticipant(participant, session) {
        return {
            ...participant,
            preparationLabel: session.rollType === "combined" ? session.title : participant.label,
            modifierDisplay: this.#dicePresenter.formatModifierLabel(participant.modifierDice ?? 0)
        };
    }

    #buildPreparationTactic([key, label], session) {
        return {
            key,
            label: game.i18n.localize(`ROE_COC7.Combat.Tactical.${label}`),
            active: Boolean(session.tacticalFlags?.[key])
        };
    }

    #buildPreparationDifficulty(difficulty, session) {
        return {
            value: difficulty,
            label: game.i18n.localize(`ROE_COC7.Difficulty.${difficulty.capitalize()}`),
            selected: session.difficulty === difficulty
        };
    }

    #buildResolvedSingleActorContext(session) {
        const participants = session.participants ?? [];
        const first = participants.at(0);
        const actorName = first?.actorName?.toUpperCase() ?? "";

        if (session.rollType === "combined") {
            const checks = participants.map((participant) => this.#buildResolvedCombinedCheck(participant, session));
            const allVisible = checks.every((c) => c.canView);
            const passed = session.combinedMode === "or"
                ? participants.some((p) => p.isSuccess)
                : participants.every((p) => p.isSuccess);
            return {
                resolvedActorName: actorName,
                isResolvedCombined: true,
                resolvedCombinedChecks: checks,
                resolvedSuccessLevel: allVisible ? (passed ? "regular" : "failure") : "",
                resolvedCombinedSummary: allVisible
                    ? game.i18n.localize(passed ? "ROE_COC7.SuccessLevels.regular" : "ROE_COC7.SuccessLevels.failure")
                    : ""
            };
        }

        const canView = Boolean(first && RollVisibilityPolicy.canViewParticipantRoll(first, session));
        if (!canView) {
            return {
                resolvedActorName: actorName,
                isResolvedCombined: false,
                resolvedCanInspect: false,
                resolvedParticipantKey: first?.key ?? "",
                resolvedSuccessLevel: "",
                resolvedNumberText: "",
                resolvedLevelText: game.i18n.localize("ROE.RollSession.HiddenRoll")
            };
        }

        if (session.rollType === "other") {
            return {
                resolvedActorName: actorName,
                isResolvedCombined: false,
                resolvedCanInspect: true,
                resolvedParticipantKey: first.key,
                resolvedSuccessLevel: "",
                resolvedNumberText: "",
                resolvedLevelText: String(first.total ?? "")
            };
        }

        const displayMode = game.settings?.get("narrative-rolls-and-effects-coc7", "resultDisplayMode") || "both";
        const numberPart = first.targetValue ? `${first.total} vs. ${first.targetValue}` : `${first.total}`;
        const levelPart = CoC7ResultFormatter.formatSuccessLevel(first.successLevel);

        return {
            resolvedActorName: actorName,
            isResolvedCombined: false,
            resolvedCanInspect: true,
            resolvedParticipantKey: first.key,
            resolvedSuccessLevel: first.successLevel ?? "",
            resolvedIsPushed: Boolean(first.hasRolled && first.isPushed),
            resolvedIsPushFailure: CoC7ResultFormatter.isVisiblePushFailure(first, session, canView),
            resolvedNumberText: displayMode !== "level" ? numberPart : "",
            resolvedLevelText: displayMode !== "numbers" ? levelPart : ""
        };
    }

    #buildResolvedCombinedCheck(participant, session) {
        const canView = RollVisibilityPolicy.canViewParticipantRoll(participant, session);
        return {
            key: participant.key,
            label: participant.label,
            canView,
            isPushFailure: CoC7ResultFormatter.isVisiblePushFailure(participant, session, canView),
            successLevel: canView ? participant.successLevel : "",
            result: canView
                ? CoC7ResultFormatter.formatPushedOutcome(CoC7ResultFormatter.formatRollOutcome({
                    total: participant.total,
                    targetValue: participant.targetValue,
                    successLevel: participant.successLevel
                }), participant, canView, session)
                : game.i18n.localize("ROE.RollSession.HiddenRoll")
        };
    }

    #buildResolvedOpposedContext(session) {
        const contestants = (session.participants ?? [])
            .map((participant) => this.#buildResolvedContestant(participant, session));
        return {
            resolvedActorName: game.i18n.localize("ROE_COC7.RollSession.Types.opposed").toUpperCase(),
            resolvedOpposedContestants: contestants
        };
    }

    #buildResolvedContestant(participant, session) {
        const canView = RollVisibilityPolicy.canViewParticipantRoll(participant, session);
        return {
            key: participant.key,
            actorName: participant.actorName,
            label: participant.label,
            canView,
            isPushFailure: CoC7ResultFormatter.isVisiblePushFailure(participant, session, canView),
            isWinner: session.winnerKey === participant.key,
            successLevel: participant.successLevel ?? "",
            result: CoC7ResultFormatter.formatPushedOutcome(CoC7ResultFormatter.formatRollOutcome({
                total: participant.total,
                targetValue: participant.targetValue,
                successLevel: participant.successLevel,
                allowNumbers: canView
            }), participant, canView, session)
        };
    }

    #buildResolvedSanityContext(session) {
        const sanRoll = session.participants?.find((p) => p.key === "p0") ?? session.participants?.at(0);
        const intRoll = session.participants?.find((p) => p.key === "insanityInt") ?? null;
        const canViewSan = Boolean(sanRoll && RollVisibilityPolicy.canViewParticipantRoll(sanRoll, session));
        const canViewInt = Boolean(intRoll && RollVisibilityPolicy.canViewParticipantRoll(intRoll, session));
        const enriched = CoC7SessionFactory.enrichForTemplate(session);
        const statusText = enriched.sanityInsanityBadge || enriched.sanityRepressedBadge || "";

        const displayMode = game.settings?.get("narrative-rolls-and-effects-coc7", "resultDisplayMode") || "both";
        const numberPart = sanRoll?.targetValue ? `${sanRoll.total} vs. ${sanRoll.targetValue}` : `${sanRoll?.total ?? ""}`;
        const levelPart = canViewSan ? CoC7ResultFormatter.formatSuccessLevel(sanRoll?.successLevel) : "";

        return {
            resolvedActorName: sanRoll?.actorName?.toUpperCase() ?? "",
            resolvedTitle: game.i18n.localize("ROE_COC7.RollSession.Types.sanity"),
            resolvedCanViewSanity: canViewSan,
            resolvedSanityLevel: canViewSan ? (sanRoll?.successLevel ?? "") : "",
            resolvedSanityNumberText: canViewSan && displayMode !== "level" ? numberPart : "",
            resolvedSanityLevelText: canViewSan
                ? (displayMode !== "numbers" ? levelPart : "")
                : game.i18n.localize("ROE.RollSession.HiddenRoll"),
            resolvedHasIntCheck: Boolean(intRoll),
            resolvedIntLabel: intRoll?.label ?? "",
            resolvedCanViewInt: canViewInt,
            resolvedIntLevel: canViewInt ? intRoll.successLevel : "",
            resolvedIntRollText: intRoll
                ? canViewInt
                    ? CoC7ResultFormatter.formatRollOutcome({ total: intRoll.total, targetValue: intRoll.targetValue, successLevel: intRoll.successLevel })
                    : game.i18n.localize("ROE.RollSession.HiddenRoll")
                : "",
            resolvedSanityLost: canViewSan ? Number(session.sanityLost ?? 0) : "?",
            resolvedSanityStatusText: canViewSan ? statusText : "",
            resolvedIsInsane: Boolean(canViewSan && enriched.sanityInsanityBadge)
        };
    }

    async #togglePreparedTactical(prompt, target) {
        const session = prompt.session;
        const key = target.dataset.flag;
        const allowed = session?.rollType === "ranged"
            ? ["pointBlank", "cover", "fastTarget", "inMelee", "proneTarget", "smallTarget", "largeTarget"]
            : ["outnumbered", "surprised", "proneTarget"];
        if (!game.user.isGM || !session?.isPreparingModifiers || !allowed.includes(key)) return;
        const tacticalFlags = { ...session.tacticalFlags, [key]: !session.tacticalFlags?.[key] };
        if (key === "smallTarget" && tacticalFlags.smallTarget) tacticalFlags.largeTarget = false;
        if (key === "largeTarget" && tacticalFlags.largeTarget) tacticalFlags.smallTarget = false;
        await UniversalRollOrchestrator.updateSessionPatch(prompt._messageId, { tacticalFlags });
    }

    async #setPreparedRangeTier(prompt, target) {
        const session = prompt.session;
        const tier = target.dataset.range;
        if (!game.user.isGM || !session?.isPreparingModifiers || session.rollType !== "ranged") return;
        if (!["normal", "long", "extreme"].includes(tier) || tier === session.rangedRangeTier) return;
        const difficulty = tier === "extreme" ? "extreme" : tier === "long" ? "hard" : "regular";
        await UniversalRollOrchestrator.updateSessionPatch(prompt._messageId, { rangedRangeTier: tier, difficulty });
    }

    async #setPreparedDifficulty(prompt, target) {
        const session = prompt.session;
        const difficulty = target.dataset.difficulty;
        if (
            !game.user.isGM ||
            !session?.isPreparingModifiers ||
            session.canChangeDifficulty === false ||
            !DIFFICULTY_PREPARATION_ROLL_TYPES.has(session.rollType) ||
            !PREPARATION_DIFFICULTIES.includes(difficulty) ||
            difficulty === session.difficulty
        ) return;
        await UniversalRollOrchestrator.updateSessionPatch(prompt._messageId, { difficulty });
    }
}
