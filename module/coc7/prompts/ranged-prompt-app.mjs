import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy, DiceVisualizer } from "../../core-bridge.mjs";
import { DamageRollSubmitter } from "./damage-roll-submitter.mjs";
import { DamageDecisionHandler } from "./damage-decision-handler.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { RangedWeaponService } from "../ranged/ranged-weapon-service.mjs";
import { RangedCombatRules } from "../ranged/ranged-combat-rules.mjs";
import { RangedDamageState } from "../ranged/ranged-damage-state.mjs";
import { CoC7Settings } from "../coc7-settings.mjs";
import { CombatConsequenceApplier } from "../strategies/combat-consequence-applier.mjs";
import { CombatDamageDecision } from "../strategies/combat-damage-decision.mjs";

const PHASE_ORDER = ["reaction", "attack", "resolution"];
const PENDING_PARTICIPANT_BY_PHASE = { reaction: "defender", attack: "attacker", resolution: "damage" };
const RANGED_PROMPT_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/ranged-prompt.hbs";

/** Ranged attack prompt supporting single shots, multiple shots, bursts, full-auto volleys, ammo, and malfunctions. */
export function createRangedPromptApp(core, BasicPromptApp) {
    const ParentPromptApp = core.extendPromptClass(BasicPromptApp, { template: RANGED_PROMPT_TEMPLATE });
    return class RangedPromptApp extends ParentPromptApp {
        #automaticDamageKey = "";
        static DEFAULT_OPTIONS = {
            actions: {
                executeRoll: RangedPromptApp.#onRollAttack,
                chooseCover: RangedPromptApp.#onChooseCover,
                setFireMode: RangedPromptApp.#onSetFireMode,
                reloadWeapon: RangedPromptApp.#onReloadWeapon,
                clearMalfunction: RangedPromptApp.#onClearMalfunction,
                switchRangedTarget: RangedPromptApp.#onSwitchRangedTarget,
                stopAutoFire: RangedPromptApp.#onStopAutoFire,
                finishRangedAttack: RangedPromptApp.#onFinishRangedAttack,
                executeDamageRoll: RangedPromptApp.#onExecuteDamageRoll,
                decideDamage: RangedPromptApp.#onDecideDamage
            }
        };

        /** Prepares the current ranged phase, available actions, and damage display. */
        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const sys = this.session;
            if (!sys) return context;

            const phase = sys.combatPhase || "reaction";
            const attacker = this.#findParticipant(sys, "attacker");
            const target = this.#findParticipant(sys, "defender");
            const damageEntries = (sys.participants ?? []).filter((p) => p.key === "damage" || p.key.startsWith("damage_"));
            const damageEntry = damageEntries.find((p) => !p.hasRolled) ?? damageEntries[damageEntries.length - 1];
            const pendingDamage = damageEntries.find((p) => !p.hasRolled);
            const pendingDecision = Boolean(CombatDamageDecision.pendingKey(sys));

            const isGM = game.user.isGM;
            const attActor = this.#resolveActor(attacker);
            const targetActor = this.#resolveActor(target);
            const weapon = this.#resolveWeapon(attActor, sys);
            const profile = RangedWeaponService.getWeaponCombatProfile(weapon, Number(attacker?.targetValue ?? 0));

            const tookCover = Boolean(target?.tookCover);
            const fireMode = sys.rangedFireMode || "single";
            const shots = Array.isArray(sys.rangedShots) ? sys.rangedShots : [];
            const shotsFired = Number(sys.rangedShotsFired ?? 0);
            const volleyIndex = Number(sys.volleyCount ?? sys.rangedVolleyIndex ?? 0);
            const isJammed = Boolean(sys.rangedMalfunction || profile.isJammed);

            const rawMod = attacker
                ? RangedCombatRules.computeModifierDice(sys, attacker, { fireMode, shotIndex: shotsFired, volleyIndex })
                : 0;
            const effectiveMod = Math.clamp(rawMod, -2, 2);
            const requiredDifficulty = RangedCombatRules.computeRequiredDifficulty(sys, rawMod);

            const isAttackerOwner = Boolean(attActor?.isOwner);
            const isTargetOwner = Boolean(targetActor?.isOwner);
            const canActAttacker = isGM || isAttackerOwner;
            const canViewAttackerRoll = attacker ? (isAttackerOwner || RollVisibilityPolicy.canViewParticipantRoll(attacker, sys)) : false;
            const canViewDamage = damageEntry ? RollVisibilityPolicy.canViewParticipantRoll(damageEntry, sys) : false;

            const bulletsPerAction = RangedCombatRules.getBulletsForNextAction(fireMode, profile);
            const remainingCapacity = RangedCombatRules.getRemainingRoundCapacity(sys, profile);
            const hasEnoughAmmo = !profile.tracksAmmo || profile.ammo >= (fireMode === "auto" ? 3 : bulletsPerAction);
            const hasStartedFiring = shotsFired > 0;
            const isAuto = fireMode === "auto";
            const targetOptions = this.#buildTargetOptions(sys);

            const fireModeOptions = profile.fireModes.map((mode) => ({
                id: mode,
                label: game.i18n.localize(`ROE_COC7.Ranged.FireModes.${mode}`),
                active: fireMode === mode
            }));

            const attackerDice = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, effectiveMod);
            const damageHit = sys.rangedHits?.find((hit) => damageEntry?.shotNumber
                ? hit.shotNumber === damageEntry.shotNumber : !damageEntry?.targetKey || hit.targetKey === damageEntry.targetKey);
            const damageDice = canViewDamage
                ? DiceVisualizer.getDiceVisuals({ rollType: "other", diceFormula: damageHit?.formula ?? damageEntry?.diceFormula ?? sys.damageFormula })
                : [];
            return {
                ...context,
                isPhaseReaction: phase === "reaction",
                isPhaseAttack: phase === "attack",
                isPhaseResolution: phase === "resolution",

                weaponName: sys.weaponName || sys.title,
                attackerName: attacker?.actorName ?? "",
                attackerImg: attacker?.actorImg ?? "",
                targetName: target?.actorName ?? "",
                targetImg: target?.actorImg ?? "",

                isAttackerOwner,
                isTargetOwner,
                canActAsTarget: isGM || isTargetOwner,
                isTargetDelegated: this._isDelegatedToActivePlayer(target),
                isAttackerDelegated: this._isDelegatedToActivePlayer(attacker),
                isDamageDelegated: this._isDelegatedToActivePlayer(damageEntry),

                tracksAmmo: profile.tracksAmmo,
                ammoCurrent: profile.ammo ?? 0,
                ammoMax: profile.ammoMax,
                isOutOfAmmo: profile.tracksAmmo && profile.ammo === 0,
                isJammed,
                canReload: phase === "attack" && !pendingDamage && !pendingDecision && !sys.isResolved && canActAttacker && !isAuto && profile.tracksAmmo && profile.ammo !== profile.ammoMax && remainingCapacity > 0,
                canClearMalfunction: phase === "attack" && !pendingDamage && !pendingDecision && !sys.isResolved && canActAttacker && isJammed,
                canSwitchTarget: phase === "attack" && !pendingDamage && !pendingDecision && !sys.isResolved && canActAttacker && (isAuto || fireMode === "multiple") && hasStartedFiring && !isJammed,
                canStopAutoFire: phase === "attack" && !pendingDamage && !pendingDecision && !sys.isResolved && canActAttacker && isAuto && hasStartedFiring,
                canFinishSeries: phase === "attack" && !pendingDamage && !pendingDecision && !sys.isResolved && canActAttacker && !isAuto && hasStartedFiring,
                canFireNext: phase === "attack" && !pendingDamage && !pendingDecision && !sys.isResolved && canActAttacker && !isJammed && hasEnoughAmmo
                    && (isAuto ? rawMod >= -2 : remainingCapacity > 0),
                pendingShotDamage: Boolean(pendingDamage && phase === "attack"),
                pendingDamageDecision: pendingDecision,
                canDecideDamage: Boolean(isGM && pendingDecision && !sys.isResolved),
                damagePreviews: isGM && (pendingDecision || !sys.rangedDamageDecisionStarted && sys.hasPendingConsequences)
                    ? this.#buildDamagePreviews(sys) : [],
                targetOptions,
                isAutoFire: isAuto,
                volleyStatus: isAuto ? game.i18n.format("ROE_COC7.Ranged.VolleyStatus", { volley: volleyIndex + 1, ammo: profile.ammo ?? "-" }) : "",
                traversePenaltyNote: sys.traversePenaltyDice
                    ? game.i18n.format("ROE_COC7.Ranged.TraversePenaltyNote", { distance: Number(sys.traverseDistance).toFixed(1), penalty: sys.traversePenaltyDice }) : "",
                autoPenaltyLimit: isAuto && rawMod < -2,

                hasStartedFiring,
                activeFireModeLabel: game.i18n.localize(`ROE_COC7.Ranged.FireModes.${fireMode}`),
                remainingShotsLabel: game.i18n.format("ROE_COC7.Ranged.RemainingShots", {
                    remaining: remainingCapacity,
                    max: fireMode === "multiple" || fireMode === "auto" ? profile.maxUses : 1
                }),
                showRemainingShots: fireMode === "multiple" && remainingCapacity > 0,
                hasMultipleFireModes: !hasStartedFiring && fireModeOptions.length > 1,
                fireModeOptions,
                fireModeHint: this.#buildFireModeHint(fireMode, profile, bulletsPerAction, requiredDifficulty),
                rangedShots: shots.map((s) => ({
                    ...s,
                    levelLabel: s.successLevel ? CoC7ResultFormatter.formatSuccessLevel(s.successLevel) : ""
                })),
                hasRangedShots: shots.length > 0,

                targetTookCover: tookCover,
                coverResultText: target?.hasRolled ? game.i18n.localize(tookCover ? "ROE_COC7.Ranged.CoverTaken" : "ROE_COC7.Ranged.NoCover") : "",
                manualModifierDice: Number(attacker?.modifierDice ?? 0),
                flagModifierDice: effectiveMod - Number(attacker?.modifierDice ?? 0),
                effectiveModifierDice: effectiveMod,
                effectiveModifierLabel: this._formatModifierLabel(effectiveMod),
                requiredDifficultyLabel: game.i18n.localize(`ROE_COC7.Difficulty.${requiredDifficulty.capitalize()}`),
                showRequiredDifficulty: requiredDifficulty !== "regular",
                attackerDice,
                attackerDiceLabel: this._formatDiceFormulaLabel(attackerDice),
                damageDice,
                damageDiceLabel: canViewDamage ? this._formatDiceFormulaLabel(damageDice) : "",
                attackerRollBtnLabel: isAuto && hasStartedFiring
                    ? game.i18n.localize("ROE_COC7.Ranged.FireNextVolleyBtn")
                    : this.#buildFireButtonLabel(attacker, fireMode, bulletsPerAction, shotsFired),
                attackerResultText: attacker?.hasRolled
                    ? CoC7ResultFormatter.formatRollOutcome({
                        total: attacker.total,
                        targetValue: attacker.targetValue,
                        successLevel: attacker.successLevel,
                        allowNumbers: canViewAttackerRoll
                    })
                    : "",

                hasDamageStep: Boolean(damageEntry),
                hasMultipleDamageEntries: damageEntries.length > 1,
                damageEntries: damageEntries.map((entry) => ({
                    ...entry, canView: RollVisibilityPolicy.canViewParticipantRoll(entry, sys)
                })),
                damageLabel: damageEntry?.label ?? "",
                damageFormula: canViewDamage ? (damageEntry?.diceFormula ?? sys.damageFormula) : "???",
                damageRolled: Boolean(damageEntry?.hasRolled),
                damageTotal: canViewDamage ? (damageEntry?.total ?? 0) : "?",
                canViewDamage,
                canRollDamage: Boolean((phase === "resolution" || phase === "attack") && damageEntry && !damageEntry.hasRolled && !pendingDecision && (isGM || this.#resolveActor(damageEntry)?.isOwner) && !sys.isResolved),
                canApplyConsequences: !pendingDecision && context.canApplyConsequences && damageEntries.every((p) => p.hasRolled),
                canResolve: !pendingDecision && context.canResolve,
                hasCombatDamage: Boolean(canViewDamage && sys.finalDamage !== null && sys.finalDamage !== undefined),
                finalDamage: sys.finalDamage ?? 0,
                armorApplied: sys.armorApplied ?? 0,
                majorWoundTriggered: Boolean(isGM && sys.majorWoundTriggered)
            };
        }

        /** Starts an automatic pending damage roll for the client that made the attack. */
        _onRender(context, options) {
            super._onRender(context, options);
            if (CombatDamageDecision.pendingKey(this.session)) return;
            const damage = this.session?.participants?.find((entry) => entry.shotNumber && !entry.hasRolled);
            if (!damage || damage.rollerUserId !== game.user.id || !CoC7Settings.shouldAutoRollRangedDamage()) return;
            if (this.#automaticDamageKey === damage.key) return;
            this.#automaticDamageKey = damage.key;
            this.#rollAutomaticDamage(damage.key);
        }

        async #rollAutomaticDamage(key) {
            try {
                await DamageRollSubmitter.submit(this._messageId, key);
            } catch (error) {
                console.error("Failed to roll ranged damage automatically.", error);
                ui.notifications?.error(game.i18n.localize("ROE_COC7.Ranged.AutomaticDamageFailed"));
            }
        }
        /** @override */
        _getPhases(sys) {
            const current = PHASE_ORDER.indexOf(sys?.combatPhase || "reaction");
            return PHASE_ORDER.map((id, index) => ({
                id,
                isActive: index === current,
                isCompleted: current !== -1 && !(index >= current)
            }));
        }

        /** Reports whether the current player owns an outstanding ranged action. */
        _hasPendingPlayerAction() {
            const sys = this.session;
            if (!sys || sys.isResolved) return false;
            if (CombatDamageDecision.pendingKey(sys)) return false;
            const participant = sys.combatPhase === "resolution" || sys.participants?.some((p) => p.shotNumber && !p.hasRolled)
                ? sys.participants?.find((p) => (p.key === "damage" || p.key.startsWith("damage_")) && !p.hasRolled)
                : this.#findParticipant(sys, PENDING_PARTICIPANT_BY_PHASE[sys.combatPhase]);
            return Boolean(participant && !participant.hasRolled && this.#resolveActor(participant)?.isOwner);
        }

        /** @override */
        _buildPhaseSummary(sys) {
            const attacker = this.#findParticipant(sys, "attacker");
            const target = this.#findParticipant(sys, "defender");
            const names = { attacker: attacker?.actorName ?? "", target: target?.actorName ?? "" };
            if (sys.combatPhase === "reaction") return game.i18n.format("ROE_COC7.Ranged.Summary.Reaction", { ...names, weapon: sys.weaponName || sys.title });
            if (sys.combatPhase === "attack") return game.i18n.format(target?.tookCover ? "ROE_COC7.Ranged.Summary.Cover" : "ROE_COC7.Ranged.Summary.NoCover", names);
            if (sys.hitWinnerKey) return game.i18n.format("ROE_COC7.Combat.Summary.Hit", { winner: names.attacker, target: names.target });
            return "";
        }

        #getLiveSession() {
            return SessionStore.getSession(game.messages.get(this._messageId)) ?? this.session;
        }

        #findParticipant(sys, key) { return sys?.participants?.find((p) => p.key === key) ?? null; }
        #resolveActor(participant) { return participant ? SessionStore.resolveActor(participant) : null; }
        #resolveWeapon(attActor, sys) {
            const weaponId = sys.weaponId || this.#findParticipant(sys, "attacker")?.itemId;
            return attActor && weaponId ? attActor.items?.get?.(weaponId) ?? null : null;
        }

        #buildTargetOptions(sys) {
            return (canvas?.tokens?.placeables ?? []).filter((token) => token.actor).map((token) => ({
                id: token.id, name: token.name || token.actor.name, selected: token.id === sys.rangedTargetTokenId
            }));
        }

        #buildDamagePreviews(sys) {
            const damage = sys.pendingDamageKey ? sys.pendingRangedDamageByActor : sys.rangedDamageByActor;
            return RangedDamageState.entries(damage).map((entry) =>
                this.#buildDamagePreview(sys, entry)
            ).filter(Boolean);
        }

        #buildDamagePreview(sys, entry) {
            const { info, actorUuid, actorId } = entry;
            const hit = sys.rangedHits?.find((hitEntry) => RangedDamageState.matchesHit(entry, hitEntry));
            const actor = RangedDamageState.resolveActor({ actorUuid, actorId });
            if (!actor) {
                return { name: hit?.targetName ?? "", status: game.i18n.localize("ROE_COC7.DamagePreview.Unavailable"), showHp: false };
            }
            const preview = CombatConsequenceApplier.previewDamage(actor, info.damage, info.majorWound, info.fatalHit ?? null);
            return {
                name: hit?.targetName ?? "", status: CombatConsequenceApplier.formatPreview(preview),
                showHp: Boolean(game.user.isGM || actor?.isOwner), remainingHp: preview.remainingHp
            };
        }

        #buildFireModeHint(fireMode, profile, bullets, requiredDifficulty) {
            if (fireMode === "multiple") return game.i18n.format("ROE_COC7.Ranged.FireModeHints.multiple", { max: profile.maxUses });
            if (fireMode === "burst") return game.i18n.format("ROE_COC7.Ranged.FireModeHints.burst", { bullets });
            if (fireMode === "auto") return game.i18n.format("ROE_COC7.Ranged.FireModeHints.auto", { bullets, difficulty: game.i18n.localize(`ROE_COC7.Difficulty.${requiredDifficulty.capitalize()}`) });
            return "";
        }

        #buildFireButtonLabel(attacker, fireMode, bullets, shotsFired) {
            const skillPart = `${attacker?.label ?? ""} (${attacker?.targetValue ?? 0}%)`;
            if (fireMode === "burst") return `${game.i18n.format("ROE_COC7.Ranged.FireBurstBtn", { bullets })} – ${skillPart}`;
            if (fireMode === "auto") return `${game.i18n.format("ROE_COC7.Ranged.FireVolleyBtn", { number: shotsFired + 1, bullets })} – ${skillPart}`;
            if (fireMode === "multiple") return `${game.i18n.format("ROE_COC7.Ranged.FireShotBtn", { number: shotsFired + 1 })} – ${skillPart}`;
            return skillPart;
        }

        static async #onChooseCover(event, trigger) {
            const sys = this.#getLiveSession();
            const target = sys?.participants?.find((p) => p.key === "defender");
            if (!target || target.hasRolled || sys.isResolved) return;
            const tookCover = trigger.dataset.cover === "true";
            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "defender", {
                total: null, successLevel: "none", isSuccess: tookCover, tookCover, modifierDice: 0,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(), rollerUserId: game.user.id
            });
        }
        static async #onSetFireMode(event, trigger) {
            const sys = this.#getLiveSession();
            const mode = trigger.dataset.mode;
            if (!sys || sys.isResolved || sys.combatPhase !== "attack" || Number(sys.rangedShotsFired ?? 0) > 0) return;
            if (["single", "multiple", "burst", "auto"].includes(mode)) {
                await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { rangedFireMode: mode });
            }
        }

        static async #onReloadWeapon() {
            const sys = this.#getLiveSession();
            if (!sys || sys.isResolved || CombatDamageDecision.pendingKey(sys) || sys.combatPhase !== "attack") return;
            const attacker = sys.participants?.find((p) => p.key === "attacker");
            const weapon = this.#resolveWeapon(SessionStore.resolveActor(attacker), sys);
            if (!weapon) return;
            const newAmmo = await RangedWeaponService.reloadWeapon(weapon);
            const nextProfile = RangedWeaponService.getWeaponCombatProfile(weapon, Number(attacker?.targetValue ?? 0));
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, {
                rangedReloadedInRound: true,
                weaponProfile: { ...nextProfile, ammo: newAmmo }
            });
        }

        static async #onClearMalfunction() {
            const sys = this.#getLiveSession();
            if (!sys || sys.isResolved || CombatDamageDecision.pendingKey(sys) || sys.combatPhase !== "attack") return;
            const attacker = sys.participants?.find((p) => p.key === "attacker");
            const attActor = SessionStore.resolveActor(attacker);
            const weapon = this.#resolveWeapon(attActor, sys);
            if (!attActor || !weapon) return;

            const mechSkill = attActor.items?.find?.((i) => i.type === "skill" && i.name.toLowerCase() === game.i18n.localize("ROE_COC7.Ranged.RepairSkillMech").toLowerCase());
            const targetVal = mechSkill ? Number(mechSkill.system?.value ?? 25) : Number(attacker?.targetValue ?? 25);
            const roll = await new Roll("1d100").evaluate();
            const total = roll.total === 0 ? 100 : roll.total;
            const fixed = (CoC7CheckResolver.LEVEL_RANK[CoC7CheckResolver.evaluateResult(total, targetVal)] ?? 0) >= 2;

            if (fixed) await RangedWeaponService.setWeaponMalfunction(weapon, false);
            const nextProfile = RangedWeaponService.getWeaponCombatProfile(weapon, Number(attacker?.targetValue ?? 0));
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, {
                rangedMalfunction: !fixed,
                rangedShotsFired: Number(sys.rangedShotsFired ?? 0) + 1,
                weaponProfile: { ...nextProfile, isJammed: !fixed }
            });
        }

        static async #onSwitchRangedTarget() {
            const sys = this.#getLiveSession();
            if (!sys || sys.isResolved || sys.combatPhase !== "attack" || !["auto", "multiple"].includes(sys.rangedFireMode)) return;
            const selected = this.element?.querySelector('[name="rangedTarget"]')?.value;
            const targeted = Array.from(game.user.targets ?? []).find((token) => token.id !== sys.rangedTargetTokenId);
            const tokenId = selected && selected !== sys.rangedTargetTokenId ? selected : targeted?.id;
            if (!tokenId) return ui.notifications?.warn(game.i18n.localize("ROE_COC7.Warnings.RangedNeedsTarget"));
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { switchRangedTarget: tokenId });
        }

        static async #onStopAutoFire() {
            const sys = this.#getLiveSession();
            if (!sys || sys.isResolved || sys.combatPhase !== "attack" || !sys.volleyCount) return;
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { stopAutoFire: true });
        }

        static async #onFinishRangedAttack() {
            const sys = this.#getLiveSession();
            if (!sys || sys.isResolved || sys.combatPhase !== "attack" || !sys.rangedShotsFired) return;
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { finishRangedAttack: true });
        }
        static async #onRollAttack() {
            const sys = this.#getLiveSession();
            const attacker = sys?.participants?.find((p) => p.key === "attacker");
            if (!attacker || attacker.hasRolled || sys.isResolved || CombatDamageDecision.pendingKey(sys) || sys.combatPhase !== "attack") return;

            const weapon = this.#resolveWeapon(SessionStore.resolveActor(attacker), sys);
            const targetValue = Number(attacker.targetValue);
            const profile = RangedWeaponService.getWeaponCombatProfile(weapon, targetValue);
            if (sys.rangedMalfunction || profile.isJammed) return;

            await this.#rollShot(sys, attacker, profile);
        }

        async #rollShot(sys, attacker, profile) {
            const mode = sys.rangedFireMode || "single";
            const needed = mode === "auto" ? 3 : RangedCombatRules.getBulletsForNextAction(mode, profile);
            if (profile.tracksAmmo && profile.ammo < needed) return;
            const rawModifier = RangedCombatRules.computeModifierDice(sys, attacker);
            if (mode === "auto" && rawModifier < -2) return;
            const modifierDice = Math.clamp(rawModifier, -2, 2);
            const roll = await new Roll(CoC7CheckResolver.buildRollFormula(modifierDice)).evaluate();
            const total = roll.total === 0 ? 100 : roll.total;
            const targetValue = Number(attacker.targetValue);
            const successLevel = CoC7CheckResolver.evaluateResult(total, targetValue);
            const difficulty = RangedCombatRules.computeRequiredDifficulty(sys, rawModifier);
            const isSuccess = total < profile.malfunctionThreshold && (CoC7CheckResolver.LEVEL_RANK[successLevel] ?? 0)
                >= (CoC7CheckResolver.LEVEL_RANK[difficulty] ?? 2);
            const tacticalFlags = Object.entries(sys.tacticalFlags ?? {}).filter(([, active]) => Boolean(active)).map(([key]) => key);
            if (sys.participants?.find((entry) => entry.key === "defender")?.tookCover && !tacticalFlags.includes("cover")) {
                tacticalFlags.push("cover");
            }
            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "attacker", {
                total, successLevel, isSuccess, modifierDice,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(), rollerUserId: game.user.id,
                rollBreakdown: CoC7CheckResolver.buildBreakdown(roll, targetValue, successLevel, { modifierDice, tacticalFlags })
            });
        }

        static async #onExecuteDamageRoll() {
            const sys = this.#getLiveSession();
            const damage = sys?.participants?.find((p) => (p.key === "damage" || p.key.startsWith("damage_")) && !p.hasRolled);
            if (damage) await DamageRollSubmitter.submit(this._messageId, damage.key);
        }

        static async #onDecideDamage(_event, trigger) {
            await DamageDecisionHandler.submit(this._messageId, trigger.dataset.decision);
        }
    };
}
