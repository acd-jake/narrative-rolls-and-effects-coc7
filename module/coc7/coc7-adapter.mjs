import { getPromptFactory } from "../core-bridge.mjs";
import { CoC7Interceptor } from "./coc7-interceptor.mjs";
import { CoC7ResultFormatter } from "./coc7-result-formatter.mjs";
import { CoC7SessionFactory } from "./coc7-session-factory.mjs";
import { BasicRollStrategy } from "./strategies/basic-roll-strategy.mjs";
import { SkillRollStrategy } from "./strategies/skill-roll-strategy.mjs";
import { CombinedRollStrategy } from "./strategies/combined-roll-strategy.mjs";
import { OpposedRollStrategy } from "./strategies/opposed-roll-strategy.mjs";
import { SanityRollStrategy } from "./strategies/sanity-roll-strategy.mjs";
import { CombatRollStrategy } from "./strategies/combat-roll-strategy.mjs";
import { RangedRollStrategy } from "./strategies/ranged-roll-strategy.mjs";
import { initializePromptApps } from "./prompts/initialize-prompt-apps.mjs";
import { CoC7RequestComposer } from "./adapter/coc7-request-composer.mjs";
import { CoC7PostRollHandler } from "./adapter/coc7-post-roll-handler.mjs";
import { CoC7SessionPatcher } from "./adapter/coc7-session-patcher.mjs";
import { CoC7PromptPresenter } from "./adapter/coc7-prompt-presenter.mjs";
import { CoC7DicePresenter } from "./adapter/coc7-dice-presenter.mjs";
import { CombatDamageDecision } from "./strategies/combat-damage-decision.mjs";

/** Connects CoC7 roll creation, prompts, consequences, and Foundry sheet interactions to the core API. */
export class CoC7Adapter {
    #strategies;
    #requestComposer;
    #postRollHandler;
    #sessionPatcher;
    #promptPresenter;
    #dicePresenter;

    /** Creates the strategy instances and focused services used by the adapter. */
    constructor() {
        this.#strategies = Object.freeze({
            basic: new BasicRollStrategy(),
            other: new BasicRollStrategy(),
            skill: new SkillRollStrategy(),
            combined: new CombinedRollStrategy(),
            opposed: new OpposedRollStrategy(),
            sanity: new SanityRollStrategy(),
            combat: new CombatRollStrategy(),
            ranged: new RangedRollStrategy()
        });
        this.#requestComposer = new CoC7RequestComposer();
        this.#postRollHandler = new CoC7PostRollHandler();
        this.#sessionPatcher = new CoC7SessionPatcher();
        this.#dicePresenter = new CoC7DicePresenter();
        this.#promptPresenter = new CoC7PromptPresenter(this.#dicePresenter);
    }

    /** Initializes prompt apps, effect presets, and sheet-click interception. */
    initialize() {
        initializePromptApps(getPromptFactory());
        this.#dicePresenter.registerEffectPresets();
        CoC7Interceptor.register();
    }

    /** Returns the strategy for a roll type, falling back to the standard check strategy. */
    getStrategy(rollType) { return this.#strategies[rollType] ?? this.#strategies.basic; }

    /** Builds participant data for a new session and initializes post-roll decision fields. */
    buildSessionPayload(type, cfg) {
        const builders = {
            basic: () => CoC7SessionFactory.createBasicOrOther(cfg),
            skill: () => CoC7SessionFactory.createSkillCheck(cfg),
            combined: () => CoC7SessionFactory.createCombined(cfg),
            opposed: () => CoC7SessionFactory.createOpposed(cfg),
            sanity: () => CoC7SessionFactory.createSanityCheck(cfg),
            combat: () => CoC7SessionFactory.createCombat(cfg),
            ranged: () => CoC7SessionFactory.createRanged(cfg)
        };
        const session = builders[type]();
        session.participants = session.participants.map((participant) => this.#initializePostRollState(participant));
        return session;
    }

    #initializePostRollState(participant) {
        return {
            ...participant,
            canPush: participant.canPush ?? true,
            isPushed: false,
            pushDecided: false,
            luckDecided: false,
            luckSpent: 0
        };
    }

    /** Supplies the default session state merged into sessions created from the given configuration. */
    getInitialSessionFields(cfg) {
        return {
            canPush: cfg.canPush ?? true,
            combinedMode: cfg.combinedMode ?? "and",
            pushFailurePending: false,
            sanityLossSuccess: cfg.sanityLossSuccess ?? "0",
            sanityLossFailure: cfg.sanityLossFailure ?? "1d6",
            sanityLost: null,
            sanityTriggersBout: false,
            sanityTriggersIndefinite: false,
            sanityPermanentInsanity: false,
            boutDurationRounds: null,
            tempInsanityHours: null,
            combatPhase: cfg.combatPhase ?? "initiator",
            combatType: cfg.combatType ?? "melee",
            weaponName: cfg.weaponName ?? "",
            weaponImg: cfg.weaponImg ?? "",
            damageFormula: cfg.damageFormula ?? "1d6",
            damageBonus: cfg.damageBonus ?? "0",
            tacticalFlags: cfg.tacticalFlags ?? { outnumbered: false, surprised: false, pointBlank: false, cover: false, proneTarget: false },
            defenderReaction: cfg.defenderReaction ?? "dodge",
            defenderWeaponId: cfg.defenderWeaponId ?? "",
            maneuverType: cfg.maneuverType ?? "disarm",
            defenderDodgeValue: cfg.defenderDodgeValue ?? 0,
            defenderFightBackValue: cfg.defenderFightBackValue ?? 0,
            hitWinnerKey: "",
            rawDamage: null,
            armorApplied: 0,
            finalDamage: null,
            majorWoundTriggered: false,
            rangedRangeTier: cfg.rangedRangeTier ?? "normal",
            rangedDistance: cfg.rangedDistance ?? null,
            rangedFireMode: cfg.rangedFireMode ?? "single",
            isAutoFire: cfg.isAutoFire ?? false,
            volleySize: cfg.volleySize ?? 3,
            remainingAmmo: cfg.remainingAmmo ?? null,
            volleyCount: cfg.volleyCount ?? 0,
            volleyLog: cfg.volleyLog ?? [],
            autoFireEnded: cfg.autoFireEnded ?? false,
            traversePenaltyDice: cfg.traversePenaltyDice ?? 0,
            traverseDistance: cfg.traverseDistance ?? 0,
            rangedTargetTokenId: cfg.rangedTargetTokenId ?? "",
            rangedShots: cfg.rangedShots ?? [],
            rangedHits: cfg.rangedHits ?? [],
            rangedShotsFired: cfg.rangedShotsFired ?? 0,
            rangedBulletsSpent: cfg.rangedBulletsSpent ?? 0,
            rangedVolleyIndex: cfg.rangedVolleyIndex ?? 0,
            rangedReloadedInRound: cfg.rangedReloadedInRound ?? false,
            rangedMalfunction: cfg.rangedMalfunction ?? false,
            weaponProfile: cfg.weaponProfile ?? null,

        };
    }

    /** Adds CoC7-specific result fields used by the chat-card and prompt templates. */ enrichSessionForTemplate(session) { return CoC7SessionFactory.enrichForTemplate(session); }
    /** Returns the actor's available checks for the roll-request composer. */ collectActorChecks(actor, options = {}) { return CoC7SessionFactory.collectActorChecks(actor, options); }
    /** Returns the localized label for a CoC7 roll type. */ getRollTypeLabel(rollType) { return game.i18n.localize(`ROE_COC7.RollSession.Types.${rollType}`); }
    /** Returns the Handlebars template used for a CoC7 session chat card. */ getChatCardTemplate() { return "modules/narrative-rolls-and-effects-coc7/templates/chat/coc7-session-card.hbs"; }
    /** Defines the roll-type tabs displayed by the request composer. */ getRequestComposerTabs() { return this.#requestComposer.getRequestComposerTabs(); }
    /** Returns the Handlebars template used for CoC7 request fields. */ getRequestComposerTemplate() { return this.#requestComposer.getRequestComposerTemplate(); }
    /** Builds request-form context, including check choices for the supplied actors. */ getRequestComposerContext(rollType, { actorA, actorB }) { return this.#requestComposer.getRequestComposerContext(rollType, { actorA, actorB }); }
    /** Starts a roll session from the request form; returns false if its primary actor is missing. */ async dispatchRequestComposer(rollType, form, { prepareModifiers }) { return this.#requestComposer.dispatchRequestComposer(rollType, form, { prepareModifiers }); }
    /** Verifies that a submitted roll uses the modifier dice allowed by its session state. */ validateSubmittedRoll(session, participant, rollData) { return this.#sessionPatcher.validateSubmittedRoll(session, participant, rollData); }
    /** Rolls and packages a participant's pushed check for the core orchestrator. */ async executePushRoll(session, participantKey) { return this.#postRollHandler.executePushRoll(session, participantKey); }
    /** Applies CoC7-specific resets and defender-reaction changes to session patches. */ transformSessionPatch(session, patch) { return this.#sessionPatcher.transformSessionPatch(session, patch); }
    /** Handles a GM decision for a pending combat damage roll. */
    async handleConsequenceDecision(session, decision) {
        if (!["combat", "ranged"].includes(session.rollType)) throw new Error("Damage decisions require a combat session.");
        if (!["apply", "decline"].includes(decision?.action)) throw new Error("Invalid damage consequence decision.");
        const pendingKey = CombatDamageDecision.pendingKey(session);
        if (!pendingKey || pendingKey !== decision.participantKey) return session;
        return this.getStrategy(session.rollType).decideDamageConsequences(session, decision.action);
    }

    /** Prevents a combat session from resolving while the GM's damage decision is pending. */
    canResolveSession(session) { return !CombatDamageDecision.pendingKey(session); }
    /** Prevents generic consequence application from bypassing a pending damage decision. */
    canApplySessionConsequences(session) { return !CombatDamageDecision.pendingKey(session); }
    /** Applies a participant's post-roll choice and returns the updated session and finalization decision. */ async handlePostRollAction(session, participantKey, actionId, payload) { return this.#postRollHandler.handlePostRollAction(session, participantKey, actionId, payload); }
    /** Calculates available Luck and push actions for a rolled participant. */ evaluateParticipantOptions(participant, session, isDelegatedToPlayer) { return this.#postRollHandler.evaluateParticipantOptions(participant, session, isDelegatedToPlayer); }
    /** Returns participants shown in modifier preparation, or an empty list otherwise. */ buildPreparationParticipants(session) { return this.#promptPresenter.buildPreparationParticipants(session); }
    /** Returns tactical modifier controls shown while preparing a combat roll. */ buildPreparationTactics(session) { return this.#promptPresenter.buildPreparationTactics(session); }
    /** Formats a participant's resolved result for the session summary. */ formatResolvedParticipant(participant, session) { return this.#dicePresenter.formatResolvedParticipant(participant, session); }
    /** Builds a permission-aware result badge for a participant in a chat card. */ formatParticipantBadge(participant, session, permissions) { return this.#dicePresenter.formatParticipantBadge(participant, session, permissions); }
    /** Adds visibility and resolved-result fields to a prompt context. */ preparePromptContext(prompt, session, context) { return this.#promptPresenter.preparePromptContext(prompt, session, context); }
    /** Builds the resolved prompt context for a viewer's chat card. */ prepareResolvedChatContext(session) { return this.#promptPresenter.prepareResolvedChatContext(session); }
    /** Returns the partials included during modifier preparation. */ getModifierPreparationPartials(session) { return this.#promptPresenter.getModifierPreparationPartials(session); }
    /** Returns the partials included when displaying resolved checks. */ getResolvedResultPartials(session) { return this.#promptPresenter.getResolvedResultPartials(session); }
    /** Returns a phase-aware waiting hint while the Keeper resolves the check. */ getPlayerWaitingHint(session) { return this.#promptPresenter.getPlayerWaitingHint(session); }
    /** Returns difficulty choices allowed in modifier preparation. */ buildPreparationDifficulties(session) { return this.#promptPresenter.buildPreparationDifficulties(session); }
    /** Identifies participants whose modifier dice change together for a roll type. */ getModifierParticipantKeys(session, participantKey) { return this.#promptPresenter.getModifierParticipantKeys(session, participantKey); }

    /** Routes prompt actions to post-roll or modifier-preparation handlers. */
    handlePromptAction(prompt, actionName, event, target) {
        if (actionName === "spendLuck") return this.#postRollHandler.handleSpendLuck(prompt, target);
        if (actionName === "declineLuck") return this.#postRollHandler.handleDeclineLuck(prompt, target);
        if (actionName === "pushRoll") return this.#postRollHandler.pushRoll(prompt, target);
        if (actionName === "togglePreparedTactical" || actionName === "setPreparedDifficulty" || actionName === "setPreparedRangeTier") {
            return this.#promptPresenter.handlePreparationAction(prompt, actionName, target);
        }
        return undefined;
    }

    /** Converts a base target to the CoC7 target number for regular, hard, or extreme difficulty. */
    getDifficultyThreshold(target, difficulty) {
        if (difficulty === "hard") return Math.floor(target / 2);
        if (difficulty === "extreme") return Math.floor(target / 5);
        return target;
    }

    /** Formats outcomes using the configured display style. */ formatRollOutcome(params) { return CoC7ResultFormatter.formatRollOutcome(params); }
    /** Returns localized display text for a success level, or an empty string when absent. */ formatSuccessLevel(level) { return CoC7ResultFormatter.formatSuccessLevel(level); }
    /** Renders regular, hard, and extreme target numbers for roll inspection. */ formatInspectionThresholds(breakdown) { return this.#dicePresenter.formatInspectionThresholds(breakdown); }
    /** Converts dice-visualizer entries into a concise, localized formula label. */ formatDiceFormulaLabel(diceArray) { return this.#dicePresenter.formatDiceFormulaLabel(diceArray); }
    /** Adds bonus- or penalty-die icons to percentile-roll visuals. */ extendDiceVisuals(dice, session, modifierDice) { return this.#dicePresenter.extendDiceVisuals(dice, session, modifierDice); }
    /** Maps an actor's Sanity value to an atmosphere state, or returns null when none applies. */ evaluateAtmosphereState(actor) { return this.#dicePresenter.evaluateAtmosphereState(actor); }
    /** Selects the visual effect associated with a participant's roll result, if any. */ getRollEffectType(participant) { return this.#dicePresenter.getRollEffectType(participant); }
    /** Reports whether updated Sanity should trigger the low-resource sound. */ didTriggerLowResourceSound(actor, changed) { return this.#dicePresenter.didTriggerLowResourceSound(actor, changed); }
}
