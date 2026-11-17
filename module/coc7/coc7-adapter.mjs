import { MODULE_ID, EffectsEngine, SessionStore, UniversalRollOrchestrator, getPromptFactory } from "../core-bridge.mjs";
import { CoC7Interceptor } from "./coc7-interceptor.mjs";
import { CoC7DataMapper } from "./coc7-data-mapper.mjs";
import { CoC7CheckResolver } from "./coc7-check-resolver.mjs";
import { CoC7ResultFormatter } from "./coc7-result-formatter.mjs";
import { CoC7SessionFactory } from "./coc7-session-factory.mjs";
import { RollVisibilityPolicy } from "../core-bridge.mjs";
import { BasicRollStrategy } from "./strategies/basic-roll-strategy.mjs";
import { SkillRollStrategy } from "./strategies/skill-roll-strategy.mjs";
import { CombinedRollStrategy } from "./strategies/combined-roll-strategy.mjs";
import { OpposedRollStrategy } from "./strategies/opposed-roll-strategy.mjs";
import { SanityRollStrategy } from "./strategies/sanity-roll-strategy.mjs";
import { CombatRollStrategy } from "./strategies/combat-roll-strategy.mjs";
import { RangedRollStrategy } from "./strategies/ranged-roll-strategy.mjs";
import { initializePromptApps } from "./prompts/initialize-prompt-apps.mjs";

const EFFECT_PRESETS = {
    majorWound: { color: 0xb81414, secondaryColor: 0x5c0505, count: 28, durationMs: 1400, gravity: 0.14, spread: 2.6 },
    temporaryInsanity: { color: 0x7b2cbf, secondaryColor: 0x240046, count: 36, durationMs: 2000, gravity: -0.06, spread: 3.2 },
    indefiniteInsanity: { color: 0x4a0e4e, secondaryColor: 0x0d0221, count: 48, durationMs: 2600, gravity: -0.08, spread: 3.8 },
    mythosSpell: { color: 0x10b981, secondaryColor: 0x064e3b, count: 44, durationMs: 2200, gravity: -0.1, spread: 3.5 },
    dying: { color: 0x8a1c1c, secondaryColor: 0x1a0000, count: 20, durationMs: 1800, gravity: 0.18, spread: 1.8 }
};

const PREPARATION_DIFFICULTIES = ["regular", "hard", "extreme"];
const DIFFICULTY_PREPARATION_ROLL_TYPES = new Set(["basic", "skill", "combined"]);

export class CoC7Adapter {
    #strategies;

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
    }

    initialize() {
        initializePromptApps(getPromptFactory());
        this.#registerEffectPresets();
        CoC7Interceptor.register();
    }

    getStrategy(rollType) {
        return this.#strategies[rollType] ?? this.#strategies.basic;
    }

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
        session.participants = session.participants.map((participant) => ({
            ...participant,
            isPushed: false,
            luckDecided: false,
            luckSpent: 0
        }));
        return session;
    }

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
            majorWoundTriggered: false
        };
    }

    enrichSessionForTemplate(session) {
        return CoC7SessionFactory.enrichForTemplate(session);
    }

    collectActorChecks(actor, options = {}) {
        return CoC7SessionFactory.collectActorChecks(actor, options);
    }

    getRollTypeLabel(rollType) {
        return game.i18n.localize(`ROE_COC7.RollSession.Types.${rollType}`);
    }

    getChatCardTemplate() {
        return "modules/narrative-rolls-and-effects-coc7/templates/chat/coc7-session-card.hbs";
    }

    getRequestComposerTabs() {
        const tabDefinitions = [
            ["skill", "fa-dice-d20"],
            ["sanity", "fa-brain"],
            ["combined", "fa-code-merge"],
            ["opposed", "fa-scale-balanced"],
            ["other", "fa-cubes"]
        ];
        return tabDefinitions.map((definition) => this.#createRequestTab(...definition));
    }

    getRequestComposerTemplate() {
        return "modules/narrative-rolls-and-effects-coc7/templates/dialogs/coc7-request-fields.hbs";
    }

    getRequestComposerContext(rollType, { actorA, actorB }) {
        return {
            rollType,
            isSkill: rollType === "skill",
            isSanity: rollType === "sanity",
            isCombined: rollType === "combined",
            isOpposed: rollType === "opposed",
            isOther: rollType === "other",
            checksA: actorA ? this.collectActorChecks(actorA, { includeSpecial: rollType === "skill" }) : [],
            checksB: actorB ? this.collectActorChecks(actorB, { includeSpecial: false }) : []
        };
    }

    async dispatchRequestComposer(rollType, form, { prepareModifiers }) {
        const actorA = game.actors.get(form.querySelector("select[name='actorA']")?.value);
        if (!actorA) return false;

        if (rollType === "skill") {
            await this.#dispatchSkillRequest(actorA, form, prepareModifiers);
        } else if (rollType === "sanity") {
            await this.#dispatchSanityRequest(actorA, form, prepareModifiers);
        } else if (rollType === "combined") {
            await this.#dispatchCombinedRequest(actorA, form, prepareModifiers);
        } else if (rollType === "opposed") {
            await this.#dispatchOpposedRequest(actorA, form, prepareModifiers);
        } else if (rollType === "other") {
            await this.#dispatchOtherRequest(actorA, form, prepareModifiers);
        } else {
            throw new Error(`Unknown Call of Cthulhu request type "${rollType}".`);
        }
        return true;
    }

    validateSubmittedRoll(session, participant, rollData) {
        if (session.rollType === "other" || participant.key === "damage") return true;
        if (participant.key === "defender" && (session.rollType === "ranged" || session.defenderReaction === "none")) return true;

        let expected = Number(participant.modifierDice ?? 0);
        if (session.rollType === "combat" && participant.key === "attacker") {
            const f = session.tacticalFlags ?? {};
            expected += Number(Boolean(f.outnumbered)) + Number(Boolean(f.surprised)) +
                Number(Boolean(f.pointBlank)) + Number(Boolean(f.proneTarget)) - Number(Boolean(f.cover));
        }
        if (session.rollType === "ranged" && participant.key === "attacker") {
            if (session.participants.find((e) => e.key === "defender")?.tookCover) expected--;
        }
        return Number(rollData.modifierDice ?? 0) === Math.clamp(expected, -2, 2);
    }

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

    transformSessionPatch(session, patch) {
        if (patch.resetCombatPhase || patch.resetSanityPhase) {
            if (session.consequencesApplied) return session;
            const clear = {
                hasRolled: false, total: null, successLevel: "", isSuccess: false,
                isPushed: false, luckDecided: false, luckSpent: 0, rollBreakdown: null
            };
            if (patch.resetCombatPhase && session.rollType === "combat") {
                const key = { initiator: "attacker", opponent: "defender" }[patch.resetCombatPhase];
                if (!key || !session.participants.find((p) => p.key === key)?.hasRolled) return session;
                return {
                    ...session,
                    participants: session.participants.filter((p) => p.key !== "damage")
                        .map((p) => p.key === key ? { ...p, ...clear } : p),
                    combatPhase: "initiator", phase: "rolling", hitWinnerKey: "", rawDamage: null,
                    armorApplied: 0, finalDamage: null, majorWoundTriggered: false,
                    hasPendingConsequences: false, winnerKey: "", outcomeHeadline: ""
                };
            }
            if (patch.resetSanityPhase && session.rollType === "sanity") {
                const key = { check: "p0", insight: "insanityInt" }[patch.resetSanityPhase];
                if (!key || !session.participants.find((p) => p.key === key)?.hasRolled) return session;
                const participants = session.participants.filter((p) => key !== "p0" || p.key !== "insanityInt")
                    .map((p) => p.key === key ? { ...p, ...clear } : p);
                const sanity = key === "p0"
                    ? {
                        sanityLost: null, sanityTriggersBout: false, sanityTriggersIndefinite: false,
                        sanityPermanentInsanity: false, boutDurationRounds: null, tempInsanityHours: null,
                        hasPendingConsequences: false
                    }
                    : { boutDurationRounds: null, tempInsanityHours: null, hasPendingConsequences: true };
                return { ...session, ...sanity, participants, phase: "rolling", winnerKey: "", outcomeHeadline: "" };
            }
            return session;
        }

        if (session.rollType === "combat" && ("defenderReaction" in patch || "reactionDetail" in patch)) {
            const defender = session.participants.find((p) => p.key === "defender");
            if (!defender || defender.hasRolled) return session;
            if ("defenderReaction" in patch) {
                const reaction = patch.defenderReaction;
                if (!["dodge", "fightBack", "maneuver", "none"].includes(reaction)) return session;
                const targetValue = reaction === "dodge" ? session.defenderDodgeValue
                    : reaction === "fightBack" || reaction === "maneuver" ? session.defenderFightBackValue : 0;
                return {
                    ...session, defenderReaction: reaction,
                    participants: session.participants.map((p) => p.key === "defender"
                        ? {
                            ...p, label: game.i18n.localize(`ROE_COC7.Combat.DefenseModes.${reaction}`), targetValue,
                            hasRolled: false, total: null, successLevel: "", isSuccess: false
                        }
                        : p)
                };
            }
            const detail = patch.reactionDetail;
            if (session.defenderReaction === "maneuver") {
                return ["disarm", "grapple", "knockdown", "push"].includes(detail)
                    ? { ...session, maneuverType: detail } : session;
            }
            if (session.defenderReaction === "fightBack") {
                const actor = SessionStore.resolveActor(defender);
                const weapon = detail === "unarmed" ? null : actor?.items.get(detail);
                if (!actor || (detail !== "unarmed" && weapon?.type !== "weapon")) return session;
                const skill = CoC7DataMapper.findActorSkill(actor, weapon
                    ? weapon.system?.skill?.main
                    : { name: game.i18n.localize("ROE_COC7.SkillList.FightingBrawl") });
                const label = weapon
                    ? `${weapon.name} (${skill?.name || game.i18n.localize("ROE_COC7.Combat.DefenseTabs.fightBack")})`
                    : game.i18n.localize("ROE_COC7.Combat.DefenseModes.fightBack");
                return {
                    ...session, defenderWeaponId: detail,
                    participants: session.participants.map((p) => p.key === "defender"
                        ? {
                            ...p, itemId: weapon?.id ?? "", label,
                            targetValue: skill ? CoC7DataMapper.getSkillValue(skill) : session.defenderFightBackValue
                        }
                        : p)
                };
            }
            return session;
        }
        return { ...session, ...patch };
    }

    /**
     * Verarbeitet Post-Roll-Aktionen (Glück ausgeben, Glück ablehnen, Probe forcieren, Forcieren-Folgen bestätigen).
     */
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

            const participants = session.participants.map((p) =>
                p.key === participantKey
                    ? { ...p, successLevel: payload.newLevel, isSuccess, luckSpent: (p.luckSpent ?? 0) + cost, luckDecided: !canUpgradeMore }
                    : p
            );
            return { session: { ...session, participants }, finalize: true };
        }

        if (actionId === "declineLuck") {
            const participants = session.participants.map((p) =>
                p.key === participantKey ? { ...p, luckDecided: true } : p
            );
            return { session: { ...session, participants }, finalize: false };
        }

        if (actionId === "pushRoll") {
            const participants = CoC7CheckResolver.buildPushedParticipants(session, participantKey, payload.rollData);
            if (!participants) return null;
            return { session: { ...session, participants }, finalize: true };
        }

        return null;
    }

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

        if (!participant.luckDecided && !isPushed && level !== "fumble" && level !== "critical" && availableLuck > 0) {
            const allowImprove = this.#isLuckImprovementAllowed();
            let desiredLevel = "";
            if (!participant.isSuccess) desiredLevel = session.difficulty || "regular";
            else if (allowImprove) {
                if (level === "regular") desiredLevel = "hard";
                else if (level === "hard") desiredLevel = "extreme";
            }

            if (desiredLevel) {
                const threshold = this.getDifficultyThreshold(participant.targetValue, desiredLevel);
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

    buildPreparationParticipants(session) {
        if (!session?.isPreparingModifiers || session.rollType === "other") return [];
        let participants = session.participants ?? [];
        if (session.rollType === "combined") participants = participants.slice(0, 1);
        if (session.rollType === "ranged") participants = participants.filter((participant) => participant.key === "attacker");
        return participants.map((participant) => ({
            ...participant,
            preparationLabel: session.rollType === "combined" ? session.title : participant.label,
            modifierDisplay: this.#formatModifierLabel(participant.modifierDice ?? 0)
        }));
    }

    buildPreparationTactics(session) {
        if (!session?.isPreparingModifiers || session.rollType !== "combat") return [];
        const labels = { outnumbered: "Outnumbered", surprised: "Surprised", proneTarget: "ProneTarget" };
        return Object.entries(labels).map(([key, label]) => ({
            key,
            label: game.i18n.localize(`ROE_COC7.Combat.Tactical.${label}`),
            active: Boolean(session.tacticalFlags?.[key])
        }));
    }

    formatResolvedParticipant(participant, session) {
        if (session.rollType === "ranged" && participant.key === "defender") {
            return game.i18n.localize(participant.tookCover ? "ROE_COC7.Ranged.CoverTaken" : "ROE_COC7.Ranged.NoCover");
        }
        if (participant.total === null) return game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none");
        if (session.rollType === "other" || participant.key === "damage") return String(participant.total ?? "");
        return this.formatRollOutcome(participant);
    }

    formatParticipantBadge(participant, session, permissions) {
        if (!permissions.canViewRoll) {
            return { text: game.i18n.localize("ROE.RollSession.HiddenRoll"), className: "pending-badge" };
        }
        if (!permissions.showDetails) {
            return { text: game.i18n.localize("ROE_COC7.Combat.Card.HiddenUntilOwnRoll"), className: "pending-badge" };
        }
        if (participant.total === null) {
            return { text: game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none"), className: "pending-badge" };
        }
        if (participant.key === "damage") {
            return { text: `${participant.total} (${participant.diceFormula})` };
        }
        if (session.rollType === "other") return { text: String(participant.total) };
        const allowNumbers = permissions.isGM || Boolean(permissions.actor?.testUserPermission(game.user, "OBSERVER"));
        return {
            text: this.formatRollOutcome({
                total: participant.total,
                targetValue: participant.targetValue,
                successLevel: participant.successLevel,
                allowNumbers
            })
        };
    }

    preparePromptContext(prompt, session, context) {
        const pushedParticipants = (session?.participants ?? []).filter((participant) => participant.isPushed);
        return {
            ...context,
            showPushFailureWarning: Boolean(game.user.isGM && session?.pushFailurePending),
            canViewPushFailure: pushedParticipants.length > 0 && pushedParticipants.every((participant) =>
                RollVisibilityPolicy.canViewParticipantRoll(participant, session)
            )
        };
    }

    getModifierPreparationPartials(session) {
        if (!session?.isPreparingModifiers) return {};
        return {
            header: "roeCocModifierPreparationHeader",
            details: "roeCocModifierPreparationDetails"
        };
    }

    buildPreparationDifficulties(session) {
        if (
            !session?.isPreparingModifiers ||
            session.canChangeDifficulty === false ||
            !DIFFICULTY_PREPARATION_ROLL_TYPES.has(session.rollType)
        ) return [];

        return PREPARATION_DIFFICULTIES.map((difficulty) => ({
            value: difficulty,
            label: game.i18n.localize(`ROE_COC7.Difficulty.${difficulty.capitalize()}`),
            selected: session.difficulty === difficulty
        }));
    }

    getModifierParticipantKeys(session, participantKey) {
        return session.rollType === "combined"
            ? session.participants.map((participant) => participant.key)
            : [participantKey];
    }

    handlePromptAction(prompt, actionName, event, target) {
        const handlers = {
            spendLuck: () => this.#spendLuck(prompt, target),
            declineLuck: () => this.#declineLuck(prompt, target),
            pushRoll: () => this.#pushRoll(prompt, target),
            togglePreparedTactical: () => this.#togglePreparedTactical(prompt, target),
            setPreparedDifficulty: () => this.#setPreparedDifficulty(prompt, target)
        };
        const handler = handlers[actionName];
        if (handler) return handler();
        return undefined;
    }

    getDifficultyThreshold(target, difficulty) {
        if (difficulty === "hard") return Math.floor(target / 2);
        if (difficulty === "extreme") return Math.floor(target / 5);
        return target;
    }

    formatRollOutcome(params) {
        return CoC7ResultFormatter.formatRollOutcome(params);
    }

    formatSuccessLevel(level) {
        return level ? game.i18n.localize(`ROE_COC7.SuccessLevels.${level}`) : "";
    }

    formatInspectionThresholds(breakdown) {
        if (breakdown.targetValue <= 0) return "";
        return `<div class="inspect-thresholds">
            <span>${game.i18n.localize("ROE_COC7.Difficulty.Regular")}: <strong>${breakdown.targetValue}</strong></span>
            <span>${game.i18n.localize("ROE_COC7.Difficulty.Hard")}: <strong>${breakdown.hardThreshold}</strong></span>
            <span>${game.i18n.localize("ROE_COC7.Difficulty.Extreme")}: <strong>${breakdown.extremeThreshold}</strong></span>
        </div>`;
    }

    formatDiceFormulaLabel(diceArray) {
        const counts = { units: 0, tens: 0, bonus: 0, penalty: 0 };
        const otherDice = [];
        for (const die of diceArray) this.#accumulateDiceLabel(die, counts, otherDice);

        const parts = [];
        if (counts.units) parts.push(`${counts.units}D10`);
        this.#appendTensLabel(parts, counts);
        for (const die of otherDice) parts.push(`${die.count}d${this.#extractDiceSides(die.label)}`);
        return parts.join(", ");
    }

    extendDiceVisuals(dice, session, modifierDice) {
        if (session?.rollType === "other") return dice;
        const modifier = Math.clamp(Number(modifierDice) || 0, -2, 2);
        const modifierVisuals = [];
        for (let i = 0; i < Math.abs(modifier); i++) {
            const isBonus = modifier > 0;
            modifierVisuals.push({
                src: `modules/narrative-rolls-and-effects-coc7/assets/dice/d10-${isBonus ? "bonus" : "penalty"}.svg`,
                label: isBonus ? "ROE.Roll.BonusDie" : "ROE.Roll.PenaltyDie",
                count: 1,
                multiple: false
            });
        }
        return [...dice, ...modifierVisuals];
    }

    // Effects engine integration points
    evaluateAtmosphereState(actor) {
        const san = CoC7DataMapper.getResource(actor, "sanity");
        if (!san || typeof san.value !== "number") return null;
        if (san.value <= 20) return "critical";
        if (san.value <= 45) return "unease";
        return null;
    }

    getRollEffectType(participant) {
        if (participant.successLevel === "fumble") return "fumble";
        if (participant.successLevel === "critical") return "critical";
        if (participant.isPushed && !participant.isSuccess) return "fumble";
        return null;
    }

    didTriggerLowResourceSound(actor, changed) {
        const newSanity = changed.system?.attribs?.san?.value;
        return typeof newSanity === "number" && newSanity <= 20;
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

    async #dispatchSkillRequest(actor, form, prepareModifiers) {
        const parsed = this.#parseCheckOption(form.querySelector("select[name='skillCheck']")?.value);
        const difficulty = form.querySelector("select[name='difficulty']")?.value || "regular";
        const item = parsed.itemId ? actor.items.get(parsed.itemId) : null;
        await UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            item,
            label: parsed.label,
            targetValue: parsed.targetValue,
            difficulty: parsed.isLuck ? "regular" : difficulty,
            canChangeDifficulty: !parsed.isLuck,
            canPush: !parsed.isLuck && item?.system?.properties?.push !== false,
            prepareModifiers
        });
    }

    async #dispatchSanityRequest(actor, form, prepareModifiers) {
        const label = form.querySelector("input[name='sanityLabel']")?.value.trim()
            || game.i18n.localize("ROE_COC7.Resources.Sanity");
        const lossSuccess = form.querySelector("input[name='lossSuccess']")?.value.trim() || "0";
        const lossFailure = form.querySelector("input[name='lossFailure']")?.value.trim() || "1d6";
        await UniversalRollOrchestrator.startSystemRoll("sanity", {
            actor, label, lossSuccess, lossFailure, prepareModifiers
        });
    }

    async #dispatchCombinedRequest(actor, form, prepareModifiers) {
        const firstCheck = this.#parseCheckOption(form.querySelector("select[name='combinedCheck1']")?.value);
        const secondCheck = this.#parseCheckOption(form.querySelector("select[name='combinedCheck2']")?.value);
        const combinedMode = form.querySelector("select[name='combinedMode']")?.value || "and";
        const difficulty = form.querySelector("select[name='difficulty']")?.value || "regular";
        await UniversalRollOrchestrator.startSystemRoll("combined", {
            actor,
            checks: [firstCheck, secondCheck],
            combinedMode,
            difficulty,
            prepareModifiers
        });
    }

    async #dispatchOpposedRequest(actorA, form, prepareModifiers) {
        const actorB = this.#findAvailableActor(form.querySelector("select[name='actorB']")?.value);
        if (!actorB) return;
        const checkA = this.#parseCheckOption(form.querySelector("select[name='opposedCheckA']")?.value);
        const checkB = this.#parseCheckOption(form.querySelector("select[name='opposedCheckB']")?.value);
        const title = form.querySelector("input[name='opposedTitle']")?.value.trim()
            || `${checkA.label} vs. ${checkB.label}`;
        await UniversalRollOrchestrator.startSystemRoll("opposed", {
            title,
            prepareModifiers,
            contestants: [
                { actor: actorA, label: checkA.label, targetValue: checkA.targetValue },
                { actor: actorB, label: checkB.label, targetValue: checkB.targetValue }
            ]
        });
    }

    async #dispatchOtherRequest(actor, form, prepareModifiers) {
        const label = form.querySelector("input[name='otherLabel']")?.value.trim()
            || game.i18n.localize("ROE_COC7.RollSession.Types.other");
        const diceFormula = form.querySelector("input[name='diceFormula']")?.value.trim() || "1d100";
        await UniversalRollOrchestrator.startSystemRoll("basic", {
            actor, label, diceFormula, isOther: true, prepareModifiers
        });
    }

    #parseCheckOption(raw) {
        const [kind, itemId, label, value] = (raw ?? "char||Check|50").split("|");
        return { isLuck: kind === "luck", itemId: itemId || null, label: label || "Check", targetValue: Number(value) || 50 };
    }

    #findAvailableActor(actorId) {
        const tokenActor = canvas?.tokens?.placeables?.find((token) => token.actor?.id === actorId)?.actor;
        return tokenActor ?? game.actors.get(actorId) ?? null;
    }

    #formatModifierLabel(modifier) {
        if (modifier > 0) {
            const label = game.i18n.localize(modifier === 1 ? "ROE.Roll.BonusDie" : "ROE.Roll.BonusDice");
            return `${modifier} ${label}`;
        }
        if (modifier < 0) {
            const count = Math.abs(modifier);
            const label = game.i18n.localize(count === 1 ? "ROE.Roll.PenaltyDie" : "ROE.Roll.PenaltyDice");
            return `${count} ${label}`;
        }
        return game.i18n.localize("ROE.Roll.BonusPenaltyLabel");
    }

    #createRequestTab(id, icon) {
        return { id, icon, label: game.i18n.localize(`ROE_COC7.RollSession.Types.${id}`) };
    }

    #accumulateDiceLabel(die, counts, otherDice) {
        const count = die.count || 1;
        const labels = {
            "ROE.Dice.D10Units": "units",
            "ROE.Dice.D10Tens": "tens",
            "ROE_COC7.Dice.D10Units": "units",
            "ROE_COC7.Dice.D10Tens": "tens",
            "ROE.Roll.BonusDie": "bonus",
            "ROE.Roll.PenaltyDie": "penalty"
        };
        const countKey = labels[die.label];
        if (countKey) counts[countKey] += count;
        else otherDice.push({ count, label: die.label });
    }

    #appendTensLabel(parts, counts) {
        const total = counts.tens + counts.bonus + counts.penalty;
        if (!total) return;
        let label = `${total}D10 ${game.i18n.localize("ROE_COC7.Dice.Tens")}`;
        const modifiers = [];
        if (counts.bonus) modifiers.push(`${counts.bonus} ${game.i18n.localize(counts.bonus === 1 ? "ROE.Roll.BonusDie" : "ROE.Roll.BonusDice")}`);
        if (counts.penalty) modifiers.push(`${counts.penalty} ${game.i18n.localize(counts.penalty === 1 ? "ROE.Roll.PenaltyDie" : "ROE.Roll.PenaltyDice")}`);
        if (modifiers.length) label += ` (${modifiers.join(", ")})`;
        parts.push(label);
    }

    #extractDiceSides(label) {
        const matches = label.match(/D(\d+)/i);
        return matches?.[1] ?? "?";
    }

    async #spendLuck(prompt, target) {
        const key = target.dataset.key || prompt.session?.participants?.[0]?.key;
        const cost = Number(target.dataset.cost);
        const newLevel = target.dataset.level;
        if (!key || !cost || !newLevel) return;
        await UniversalRollOrchestrator.executePostRollAction(prompt._messageId, key, "spendLuck", { cost, newLevel });
    }

    async #declineLuck(prompt, target) {
        const key = target.dataset.key || prompt.session?.participants?.[0]?.key;
        if (key) await UniversalRollOrchestrator.executePostRollAction(prompt._messageId, key, "declineLuck");
    }

    async #pushRoll(prompt, target) {
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

    async #togglePreparedTactical(prompt, target) {
        const session = prompt.session;
        const key = target.dataset.flag;
        if (!game.user.isGM || !session?.isPreparingModifiers || !["outnumbered", "surprised", "proneTarget"].includes(key)) return;
        const tacticalFlags = { ...session.tacticalFlags, [key]: !session.tacticalFlags?.[key] };
        await UniversalRollOrchestrator.updateSessionPatch(prompt._messageId, { tacticalFlags });
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

    #registerEffectPresets() {
        for (const [key, preset] of Object.entries(EFFECT_PRESETS)) {
            EffectsEngine.registerPreset(key, preset);
        }
    }
}