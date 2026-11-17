import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy, DiceVisualizer } from "../../core-bridge.mjs";
import { DamageRollSubmitter } from "./damage-roll-submitter.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

const COMBAT_PROMPT_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/combat-prompt.hbs";

export function createCombatPromptApp(core, OpposedPromptApp) {
    const ParentPromptApp = core.extendPromptClass(OpposedPromptApp, { template: COMBAT_PROMPT_TEMPLATE });
    return class CombatPromptApp extends ParentPromptApp {
    static DEFAULT_OPTIONS = {
        actions: {
            toggleTacticalFlag: CombatPromptApp.#onToggleTacticalFlag,
            rollInitiatorAttack: CombatPromptApp.#onRollInitiatorAttack,
            gmForceAutoSuccess: CombatPromptApp.#onGmForceAutoSuccess,
            setDefenderReaction: CombatPromptApp.#onSetDefenderReaction,
            rollOpponentReaction: CombatPromptApp.#onRollOpponentReaction,
            executeDamageRoll: CombatPromptApp.#onExecuteDamageRoll,
            resetCombatPhase: CombatPromptApp.#onResetCombatPhase
        }
    };

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);

        this.element.querySelector("select[name='defenderDetailSelect']")?.addEventListener("change", async (ev) => {
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { reactionDetail: ev.target.value });
        });
    }

    /** @override */
    async _onModifierSliderChange(val, participantKey) {
        if (participantKey) await UniversalRollOrchestrator.setParticipantModifier(this._messageId, participantKey, val);
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.session;
        if (!sys) return context;

        const isGM = Boolean(game.user?.isGM);
        const phase = sys.combatPhase || "initiator";
        const attacker = sys.participants?.find((p) => p.key === "attacker");
        const defender = sys.participants?.find((p) => p.key === "defender") ?? null;
        const damageEntry = sys.participants?.find((p) => p.key === "damage") ?? null;

        const attActor = this.#resolveActor(attacker);
        const defActor = this.#resolveActor(defender);
        const isAttackerOwner = Boolean(attActor?.isOwner);
        const isDefenderOwner = Boolean(defActor?.isOwner);

        const flags = sys.tacticalFlags ?? {};
        const flagBonus =
            (flags.outnumbered ? 1 : 0) +
            (flags.surprised ? 1 : 0) +
            (flags.pointBlank ? 1 : 0) +
            (flags.proneTarget ? 1 : 0) -
            (flags.cover ? 1 : 0);
        const attackerModifier = Number(attacker?.modifierDice ?? 0);
        const defenderModifier = Number(defender?.modifierDice ?? 0);
        const effectiveMod = Math.clamp(flagBonus + attackerModifier, -2, 2);

        const reaction = sys.defenderReaction || "dodge";
        const defenderDetailOptions = defActor ? this.#buildDefenderDetailOptions(defActor, reaction, sys) : [];

        const canViewAttackerRoll = attacker ? RollVisibilityPolicy.canViewParticipantRoll(attacker, sys) : false;
        const canViewDefenderRoll = defender ? RollVisibilityPolicy.canViewParticipantRoll(defender, sys) : false;
        const canViewDamage = damageEntry ? RollVisibilityPolicy.canViewParticipantRoll(damageEntry, sys) : false;

        const damageActor = this.#resolveActor(damageEntry);
        const attackerDice = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, effectiveMod);
        const defenderDice = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, defenderModifier);
        const damageDice = canViewDamage
            ? DiceVisualizer.getDiceVisuals({ rollType: "other", diceFormula: damageEntry?.diceFormula ?? sys.damageFormula })
            : [];

        return {
            ...context,
            isGM,
            isPhaseInitiator: !attacker?.hasRolled,
            isPhaseOpponent: Boolean(defender && !defender.hasRolled),
            isPhaseResolution: phase === "resolution",

            weaponName: sys.weaponName || sys.title,
            attackerName: attacker?.actorName ?? "",
            attackerImg: attacker?.actorImg ?? "",
            defenderName: defender?.actorName ?? "",
            defenderImg: defender?.actorImg ?? "",
            hasDefender: Boolean(defender),

            canActAsInitiator: isGM || isAttackerOwner,
            canActAsOpponent: isGM || isDefenderOwner,
            isAttackerDelegated: this._isDelegatedToActivePlayer(attacker),
            isDefenderDelegated: this._isDelegatedToActivePlayer(defender),
            isDamageDelegated: this._isDelegatedToActivePlayer(damageEntry),
            canSeeAttackerInPhase2: isGM || isAttackerOwner,

            showPhaseOpponent: Boolean(defender),
            hideInitiatorInCompact: !isAttackerOwner,
            hideOpponentInCompact: !isDefenderOwner,
            canSeeAttackerResult: phase === "resolution" ? canViewAttackerRoll : (isGM || isAttackerOwner),
            defenderReactionLabel: game.i18n.localize(`ROE_COC7.Combat.DefenseTabs.${reaction}`),

            tacticalOptions: this.#buildTacticalOptions(flags),
            attackerModifierDice: attackerModifier,
            effectiveModifierDice: effectiveMod,
            defenderModifierDice: defenderModifier,
            defenderModifierLabel: this._formatModifierLabel(defenderModifier),
            flagModifierDice: flagBonus,
            effectiveModifierLabel: this._formatModifierLabel(effectiveMod),
            attackerDice,
            attackerDiceLabel: this._formatDiceFormulaLabel(attackerDice),
            defenderDice,
            defenderDiceLabel: this._formatDiceFormulaLabel(defenderDice),
            damageDice,
            damageDiceLabel: canViewDamage ? this._formatDiceFormulaLabel(damageDice) : "",
            attackerRollBtnLabel: `${attacker?.label ?? ""} (${attacker?.targetValue ?? 0}%)`,

            attackerResultText: attacker?.hasRolled
                ? canViewAttackerRoll
                    ? CoC7ResultFormatter.formatRollOutcome({
                        total: attacker.total,
                        targetValue: attacker.targetValue,
                        successLevel: attacker.successLevel
                    })
                    : game.i18n.localize("ROE.RollSession.HiddenRoll")
                : "",

            reactionTabs: [
                { id: "dodge", label: game.i18n.localize("ROE_COC7.Combat.DefenseTabs.dodge"), active: reaction === "dodge" },
                { id: "fightBack", label: game.i18n.localize("ROE_COC7.Combat.DefenseTabs.fightBack"), active: reaction === "fightBack" },
                { id: "maneuver", label: game.i18n.localize("ROE_COC7.Combat.DefenseTabs.maneuver"), active: reaction === "maneuver" },
                { id: "none", label: game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none"), active: reaction === "none" }
            ],
            isNoneReaction: reaction === "none",
            hasDefenderDetails: defenderDetailOptions.length > 0,
            defenderDetailOptions,
            defenderRollBtnLabel:
                reaction === "none"
                    ? game.i18n.localize("ROE_COC7.Combat.ConfirmNoReaction")
                    : `${defender?.label ?? ""} (${defender?.targetValue ?? 0}%)`,

            defenderResultText: defender?.hasRolled
                ? defender.total === null
                    ? game.i18n.localize("ROE_COC7.Combat.DefenseTabs.none")
                    : canViewDefenderRoll
                        ? CoC7ResultFormatter.formatRollOutcome({
                            total: defender.total,
                            targetValue: defender.targetValue,
                            successLevel: defender.successLevel
                        })
                        : game.i18n.localize("ROE.RollSession.HiddenRoll")
                : "",
            hasDamageStep: Boolean(damageEntry),
            damageLabel: damageEntry?.label ?? "",
            damageFormula: canViewDamage ? (damageEntry?.diceFormula ?? sys.damageFormula) : "???",
            damageRolled: Boolean(damageEntry?.hasRolled),
            damageTotal: canViewDamage ? (damageEntry?.total ?? 0) : "?",
            canViewDamage,
            canRollDamage: Boolean(
                phase === "resolution" &&
                damageEntry &&
                !damageEntry.hasRolled &&
                (isGM || damageActor?.isOwner) &&
                !sys.isResolved
            ),
            hasCombatDamage: Boolean(canViewDamage && sys.finalDamage !== null && sys.finalDamage !== undefined),
            finalDamage: sys.finalDamage ?? 0,
            armorApplied: sys.armorApplied ?? 0,
            majorWoundTriggered: Boolean(sys.majorWoundTriggered),
            gmApplyDamageLabel: game.i18n.format("ROE_COC7.Combat.GmApplyDamageBtn", {
                damage: sys.finalDamage ?? 0
            })
        };
    }

    /** @override */
    _hasPendingPlayerAction() {
        const sys = this.session;
        if (!sys || sys.isResolved) return false;

        return (sys.participants ?? []).some((participant) =>
            !participant.hasRolled && this.#resolveActor(participant)?.isOwner
        );
    }

    /** @override */
    _getPhases(sys) {
        const isResolution = sys?.combatPhase === "resolution";
        return [
            { id: "combat", isActive: !isResolution, isCompleted: isResolution },
            { id: "resolution", isActive: isResolution, isCompleted: false }
        ];
    }

    /** @override */
    _buildPhaseSummary(sys) {
        const attacker = sys.participants?.find((p) => p.key === "attacker");
        const defender = sys.participants?.find((p) => p.key === "defender");

        if (sys.combatPhase === "opponent" && defender) {
            return game.i18n.format("ROE_COC7.Combat.Summary.Attack", {
                attacker: attacker?.actorName ?? "",
                defender: defender.actorName ?? "",
                weapon: sys.weaponName || sys.title
            });
        }
        if (sys.combatPhase === "resolution") {
            const winner = sys.participants?.find((p) => p.key === sys.hitWinnerKey);
            const target = winner?.key === "defender" ? attacker : defender;
            if (winner) {
                return game.i18n.format("ROE_COC7.Combat.Summary.Hit", {
                    winner: winner.actorName ?? "",
                    target: target?.actorName ?? ""
                });
            }
        }
        return "";
    }

    #buildTacticalOptions(flags) {
        return [
            { key: "outnumbered", label: game.i18n.localize("ROE_COC7.Combat.Tactical.Outnumbered"), active: Boolean(flags.outnumbered) },
            { key: "surprised", label: game.i18n.localize("ROE_COC7.Combat.Tactical.Surprised"), active: Boolean(flags.surprised) },
            { key: "proneTarget", label: game.i18n.localize("ROE_COC7.Combat.Tactical.ProneTarget"), active: Boolean(flags.proneTarget) }
        ];
    }

    #buildDefenderDetailOptions(defActor, reaction, sys) {
        if (reaction === "fightBack") {
            const weapons = defActor.items.filter((i) => i.type === "weapon" && !i.system?.properties?.rngd);
            const brawl = CoC7DataMapper.findActorSkill(defActor, { name: `skill.${game.i18n.localize("ROE_COC7.SkillList.FightingBrawl")}` });
            const brawlVal = brawl ? CoC7DataMapper.getSkillValue(brawl) : 25;

            const opts = [
                {
                    value: "unarmed",
                    label: `${game.i18n.localize("ROE_COC7.Combat.UnarmedBrawl")} (${brawlVal}%)`,
                    selected: !sys.defenderWeaponId || sys.defenderWeaponId === "unarmed"
                }
            ];

            for (const w of weapons) {
                const skill = CoC7DataMapper.findActorSkill(defActor, w.system?.skill?.main);
                const val = skill ? CoC7DataMapper.getSkillValue(skill) : brawlVal;
                opts.push({
                    value: w.id,
                    label: `${w.name} (${val}%)`,
                    selected: sys.defenderWeaponId === w.id
                });
            }
            return opts;
        }

        if (reaction === "maneuver") {
            return ["disarm", "grapple", "knockdown", "push"].map((m) => ({
                value: m,
                label: game.i18n.localize(`ROE_COC7.Combat.Maneuvers.${m}`),
                selected: (sys.maneuverType || "disarm") === m
            }));
        }

        return [];
    }

    static async #onToggleTacticalFlag(event, target) {
        const flagKey = target.dataset.flag;
        const sys = this.session;
        if (!flagKey || !sys) return;

        const nextFlags = { ...(sys.tacticalFlags ?? {}), [flagKey]: !sys.tacticalFlags?.[flagKey] };
        await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { tacticalFlags: nextFlags });
    }

    static async #onRollInitiatorAttack() {
        const sys = this.session;
        const attacker = sys?.participants?.find((p) => p.key === "attacker");
        if (!attacker || attacker.hasRolled || sys.isResolved) return;

        const flags = sys.tacticalFlags ?? {};
        const flagBonus =
            (flags.outnumbered ? 1 : 0) +
            (flags.surprised ? 1 : 0) +
            (flags.pointBlank ? 1 : 0) +
            (flags.proneTarget ? 1 : 0) -
            (flags.cover ? 1 : 0);
        const totalMod = Math.clamp(flagBonus + Number(attacker.modifierDice ?? 0), -2, 2);

        const roll = await new Roll(CoC7CheckResolver.buildRollFormula(totalMod)).evaluate();
        const total = roll.total === 0 ? 100 : roll.total;
        const successLevel = CoC7CheckResolver.evaluateResult(total, Number(attacker.targetValue));
        const tacticalFlags = ["outnumbered", "surprised", "pointBlank", "proneTarget", "cover"].filter((key) => flags[key]);
        const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, Number(attacker.targetValue), successLevel, { modifierDice: totalMod, tacticalFlags });
        const reqRank = CoC7CheckResolver.LEVEL_RANK[sys.difficulty] ?? 2;
        const isSuccess = (CoC7CheckResolver.LEVEL_RANK[successLevel] ?? 0) >= reqRank;
        const rollMode = RollVisibilityPolicy.getCurrentRollMode();
        
        await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "attacker", {
            total,
            successLevel,
            isSuccess,
            modifierDice: totalMod,
            rollMode,
            rollerUserId: game.user.id,
            rollBreakdown
        });
    }
    static async #onGmForceAutoSuccess() {
        if (!game.user.isGM) return;
        const sys = this.session;
        const attacker = sys?.participants?.find((p) => p.key === "attacker");
        if (!attacker || attacker.hasRolled) return;
        const flags = sys.tacticalFlags ?? {};
        const flagBonus = Number(Boolean(flags.outnumbered)) + Number(Boolean(flags.surprised)) +
            Number(Boolean(flags.pointBlank)) + Number(Boolean(flags.proneTarget)) - Number(Boolean(flags.cover));
        await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "attacker", {
            total: 1,
            successLevel: "critical",
            isSuccess: true,
            modifierDice: Math.clamp(Number(attacker.modifierDice ?? 0) + flagBonus, -2, 2),
            rollMode: "gmroll",
            rollerUserId: game.user.id
        });
    }
    static async #onResetCombatPhase(event, target) {
        if (!game.user.isGM || !target.dataset.phase) return;
        await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { resetCombatPhase: target.dataset.phase });
    }

    static async #onSetDefenderReaction(event, target) {
        const reaction = target.dataset.reaction;
        if (!reaction) return;
        await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { defenderReaction: reaction });
    }
    static async #onRollOpponentReaction() {
        const sys = this.session;
        const defender = sys?.participants?.find((p) => p.key === "defender");
        if (!defender || defender.hasRolled || sys.isResolved) return;
        const rollMode = RollVisibilityPolicy.getCurrentRollMode();
        if (sys.defenderReaction === "none") {
            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "defender", {
                total: null,
                successLevel: "none",
                isSuccess: false,
                modifierDice: 0,
                rollMode,
                rollerUserId: game.user.id
            });
            return;
        }
        const mod = Number(defender.modifierDice ?? 0);
        const roll = await new Roll(CoC7CheckResolver.buildRollFormula(mod)).evaluate();
        const total = roll.total === 0 ? 100 : roll.total;
        const successLevel = CoC7CheckResolver.evaluateResult(total, Number(defender.targetValue));
        const isSuccess = (CoC7CheckResolver.LEVEL_RANK[successLevel] ?? 0) >= 2;
        const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, Number(defender.targetValue), successLevel, { modifierDice: mod });
        await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "defender", {
            total,
            successLevel,
            isSuccess,
            modifierDice: mod,
            rollMode,
            rollerUserId: game.user.id,
            rollBreakdown
        });
    }
    static async #onExecuteDamageRoll() {
        await DamageRollSubmitter.submit(this._messageId);
    }
    #resolveActor(participant) {
        if (!participant) return null;
        return SessionStore.resolveActor(participant);
    }
    };
}
