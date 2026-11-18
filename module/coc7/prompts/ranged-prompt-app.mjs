import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy, DiceVisualizer } from "../../core-bridge.mjs";
import { DamageRollSubmitter } from "./damage-roll-submitter.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";
import { CoC7DataMapper } from "../coc7-data-mapper.mjs";
import { CoC7SessionPatcher } from "../adapter/coc7-session-patcher.mjs";

const PHASE_ORDER = ["reaction", "attack", "resolution"];
const PENDING_PARTICIPANT_BY_PHASE = { reaction: "defender", attack: "attacker", resolution: "damage" };

/** Ranged attack prompt supporting single shots, multiple shots, bursts, full-auto volleys, ammo, and malfunctions. */
const RANGED_PROMPT_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/ranged-prompt.hbs";

export function createRangedPromptApp(core, BasicPromptApp) {
    const ParentPromptApp = core.extendPromptClass(BasicPromptApp, { template: RANGED_PROMPT_TEMPLATE });
    return class RangedPromptApp extends ParentPromptApp {
        static DEFAULT_OPTIONS = {
            actions: {
                executeRoll: RangedPromptApp.#onRollAttack,
                chooseCover: RangedPromptApp.#onChooseCover,
                setFireMode: RangedPromptApp.#onSetFireMode,
                reloadWeapon: RangedPromptApp.#onReloadWeapon,
                clearMalfunction: RangedPromptApp.#onClearMalfunction,
                switchRangedTarget: RangedPromptApp.#onSwitchRangedTarget,
                finishRangedAttack: RangedPromptApp.#onFinishRangedAttack,
                executeDamageRoll: RangedPromptApp.#onExecuteDamageRoll
            }
        };

        /** @override */
        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            const sys = this.session;
            if (!sys) return context;

            const phase = sys.combatPhase || "reaction";
            const attacker = this.#findParticipant(sys, "attacker");
            const target = this.#findParticipant(sys, "defender");
            const damageEntry = this.#findParticipant(sys, "damage");

            const isGM = game.user.isGM;
            const attActor = this.#resolveActor(attacker);
            const targetActor = this.#resolveActor(target);
            const weapon = this.#resolveWeapon(attActor, sys);
            const profile = CoC7DataMapper.getWeaponCombatProfile(weapon, Number(attacker?.targetValue ?? 0));

            const tookCover = Boolean(target?.tookCover);
            const fireMode = sys.rangedFireMode || "single";
            const shots = Array.isArray(sys.rangedShots) ? sys.rangedShots : [];
            const shotsFired = Number(sys.rangedShotsFired ?? 0);
            const volleyIndex = Number(sys.rangedVolleyIndex ?? 0);
            const isJammed = Boolean(sys.rangedMalfunction || profile.isJammed);

            const rawMod = attacker
                ? CoC7SessionPatcher.computeRangedModifierDice(sys, attacker, { fireMode, shotIndex: shotsFired, volleyIndex })
                : 0;
            const effectiveMod = Math.clamp(rawMod, -2, 2);
            const requiredDifficulty = CoC7SessionPatcher.computeRangedRequiredDifficulty(sys, rawMod);

            const isAttackerOwner = Boolean(attActor?.isOwner);
            const isTargetOwner = Boolean(targetActor?.isOwner);
            const canActAttacker = isGM || isAttackerOwner;
            const canViewAttackerRoll = attacker ? (isAttackerOwner || RollVisibilityPolicy.canViewParticipantRoll(attacker, sys)) : false;
            const canViewDamage = damageEntry ? RollVisibilityPolicy.canViewParticipantRoll(damageEntry, sys) : false;
            const damageActor = this.#resolveActor(damageEntry);

            const attackerDice = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, effectiveMod);
            const damageDice = canViewDamage
                ? DiceVisualizer.getDiceVisuals({ rollType: "other", diceFormula: damageEntry?.diceFormula ?? sys.damageFormula })
                : [];

            const bulletsPerAction = this.#getBulletsForNextAction(fireMode, profile);
            const remainingCapacity = this.#getRemainingRoundCapacity(sys, profile);
            const hasEnoughAmmo = !profile.tracksAmmo || profile.ammo >= bulletsPerAction;
            const canFireNext = phase === "attack" && !sys.isResolved && canActAttacker && !isJammed && hasEnoughAmmo && remainingCapacity > 0;
            const canReload = phase === "attack" && !sys.isResolved && canActAttacker && profile.tracksAmmo && profile.ammo < profile.ammoMax && remainingCapacity > 0;
            const canSwitchTarget = phase === "attack" && !sys.isResolved && canActAttacker && fireMode === "auto" && shotsFired > 0 && !isJammed && remainingCapacity > 0;
            const canFinishSeries = phase === "attack" && !sys.isResolved && canActAttacker && shotsFired > 0;

            const hasStartedFiring = shotsFired > 0;
            const fireModeOptions = profile.fireModes.map((mode) => ({
                id: mode,
                label: game.i18n.localize(`ROE_COC7.Ranged.FireModes.${mode}`),
                active: fireMode === mode
            }));
            const activeFireModeLabel = game.i18n.localize(`ROE_COC7.Ranged.FireModes.${fireMode}`);
            const remainingShotsLabel = game.i18n.format("ROE_COC7.Ranged.RemainingShots", {
                remaining: remainingCapacity,
                max: fireMode === "multiple" || fireMode === "auto" ? profile.maxUses : 1
            });

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
                isOutOfAmmo: profile.tracksAmmo && profile.ammo <= 0,
                isJammed,
                malfunctionThreshold: profile.malfunctionThreshold,
                canReload,
                canClearMalfunction: phase === "attack" && !sys.isResolved && canActAttacker && isJammed,
                canSwitchTarget,
                canFinishSeries,
                canFireNext,
                hasStartedFiring,
                activeFireModeLabel,
                remainingCapacity,
                remainingShotsLabel,
                showRemainingShots: (fireMode === "multiple" || fireMode === "auto") && remainingCapacity > 0,
                hasMultipleFireModes: !hasStartedFiring && fireModeOptions.length > 1,
                fireModeOptions,
                fireModeHint: this.#buildFireModeHint(fireMode, profile, bulletsPerAction, requiredDifficulty),
                rangedShots: shots.map((s) => ({
                    ...s,
                    levelLabel: s.successLevel ? CoC7ResultFormatter.formatSuccessLevel(s.successLevel) : ""
                })),
                hasRangedShots: shots.length > 0,

                targetTookCover: tookCover,
                coverResultText: target?.hasRolled
                    ? game.i18n.localize(tookCover ? "ROE_COC7.Ranged.CoverTaken" : "ROE_COC7.Ranged.NoCover")
                    : "",

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
                attackerRollBtnLabel: this.#buildFireButtonLabel(attacker, fireMode, bulletsPerAction, shotsFired),
                attackerResultText: attacker?.hasRolled
                    ? CoC7ResultFormatter.formatRollOutcome({
                        total: attacker.total,
                        targetValue: attacker.targetValue,
                        successLevel: attacker.successLevel,
                        allowNumbers: canViewAttackerRoll
                    })
                    : "",

                hasDamageStep: Boolean(damageEntry),
                damageLabel: damageEntry?.label ?? "",
                damageFormula: canViewDamage ? (damageEntry?.diceFormula ?? sys.damageFormula) : "???",
                damageRolled: Boolean(damageEntry?.hasRolled),
                damageTotal: canViewDamage ? (damageEntry?.total ?? 0) : "?",
                canViewDamage,
                canRollDamage: Boolean(
                    phase === "resolution" && damageEntry && !damageEntry.hasRolled &&
                    (isGM || damageActor?.isOwner) && !sys.isResolved
                ),
                hasCombatDamage: Boolean(canViewDamage && sys.finalDamage !== null && sys.finalDamage !== undefined),
                finalDamage: sys.finalDamage ?? 0,
                armorApplied: sys.armorApplied ?? 0,
                majorWoundTriggered: Boolean(sys.majorWoundTriggered)
            };
        }
        /** @override */
        _getPhases(sys) {
            const current = PHASE_ORDER.indexOf(sys?.combatPhase || "reaction");
            return PHASE_ORDER.map((id, index) => ({ id, isActive: index === current, isCompleted: index < current }));
        }

        /** @override */
        _hasPendingPlayerAction() {
            const sys = this.session;
            if (!sys || sys.isResolved) return false;
            const participant = this.#findParticipant(sys, PENDING_PARTICIPANT_BY_PHASE[sys.combatPhase]);
            return Boolean(participant && !participant.hasRolled && this.#resolveActor(participant)?.isOwner);
        }

        /** @override */
        _buildPhaseSummary(sys) {
            const attacker = this.#findParticipant(sys, "attacker");
            const target = this.#findParticipant(sys, "defender");
            const names = { attacker: attacker?.actorName ?? "", target: target?.actorName ?? "" };

            if (sys.combatPhase === "reaction") {
                return game.i18n.format("ROE_COC7.Ranged.Summary.Reaction", { ...names, weapon: sys.weaponName || sys.title });
            }
            if (sys.combatPhase === "attack") {
                const key = target?.tookCover ? "ROE_COC7.Ranged.Summary.Cover" : "ROE_COC7.Ranged.Summary.NoCover";
                return game.i18n.format(key, names);
            }
            if (sys.hitWinnerKey) {
                return game.i18n.format("ROE_COC7.Combat.Summary.Hit", { winner: names.attacker, target: names.target });
            }
            return "";
        }

        #findParticipant(sys, key) {
            return sys?.participants?.find((p) => p.key === key) ?? null;
        }

        #resolveActor(participant) {
            if (!participant) return null;
            return SessionStore.resolveActor(participant);
        }

        #resolveWeapon(attActor, sys) {
            if (!attActor) return null;
            const attacker = this.#findParticipant(sys, "attacker");
            const weaponId = sys.weaponId || attacker?.itemId;
            return weaponId ? attActor.items?.get?.(weaponId) ?? null : null;
        }

        #getBulletsForNextAction(fireMode, profile) {
            if (fireMode === "burst") return Math.max(2, profile.burstSize || 3);
            if (fireMode === "auto") return Math.max(3, profile.autoVolleySize || 3);
            return 1;
        }

        #getRemainingRoundCapacity(sys, profile) {
            const reloadPenalty = sys.rangedReloadedInRound ? 1 : 0;
            const fired = Number(sys.rangedShotsFired ?? 0);
            const mode = sys.rangedFireMode || "single";
            const maxActions = mode === "multiple" || mode === "auto" ? profile.maxUses : 1;
            return Math.max(0, maxActions - fired - reloadPenalty);
        }

        #buildFireModeHint(fireMode, profile, bullets, requiredDifficulty) {
            if (fireMode === "multiple") {
                return game.i18n.format("ROE_COC7.Ranged.FireModeHints.multiple", { max: profile.maxUses });
            }
            if (fireMode === "burst") {
                return game.i18n.format("ROE_COC7.Ranged.FireModeHints.burst", { bullets });
            }
            if (fireMode === "auto") {
                return game.i18n.format("ROE_COC7.Ranged.FireModeHints.auto", {
                    bullets,
                    difficulty: game.i18n.localize(`ROE_COC7.Difficulty.${requiredDifficulty.capitalize()}`)
                });
            }
            return "";
        }

        #buildFireButtonLabel(attacker, fireMode, bullets, shotsFired) {
            const skillPart = `${attacker?.label ?? ""} (${attacker?.targetValue ?? 0}%)`;
            if (fireMode === "burst") {
                return `${game.i18n.format("ROE_COC7.Ranged.FireBurstBtn", { bullets })} – ${skillPart}`;
            }
            if (fireMode === "auto") {
                return `${game.i18n.format("ROE_COC7.Ranged.FireVolleyBtn", { number: shotsFired + 1, bullets })} – ${skillPart}`;
            }
            if (fireMode === "multiple") {
                return `${game.i18n.format("ROE_COC7.Ranged.FireShotBtn", { number: shotsFired + 1 })} – ${skillPart}`;
            }
            return skillPart;
        }
        static async #onChooseCover(event, trigger) {
            const sys = this.session;
            const target = sys?.participants?.find((p) => p.key === "defender");
            if (!target || target.hasRolled || sys.isResolved) return;

            const tookCover = trigger.dataset.cover === "true";
            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "defender", {
                total: null,
                successLevel: "none",
                isSuccess: tookCover,
                tookCover,
                modifierDice: 0,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id
            });
        }

        static async #onSetFireMode(event, trigger) {
            const sys = this.session;
            const mode = trigger.dataset.mode;
            if (!sys || sys.isResolved || sys.combatPhase !== "attack") return;
            if (Number(sys.rangedShotsFired ?? 0) > 0) return;
            if (!["single", "multiple", "burst", "auto"].includes(mode)) return;
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, { rangedFireMode: mode });
        }

        static async #onReloadWeapon() {
            const sys = this.session;
            if (!sys || sys.isResolved || sys.combatPhase !== "attack") return;
            const attacker = sys.participants?.find((p) => p.key === "attacker");
            const attActor = SessionStore.resolveActor(attacker);
            const weapon = this.#resolveWeapon(attActor, sys);
            if (!weapon) return;

            const newAmmo = await CoC7DataMapper.reloadWeapon(weapon);
            const nextProfile = CoC7DataMapper.getWeaponCombatProfile(weapon, Number(attacker?.targetValue ?? 0));
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, {
                rangedReloadedInRound: true,
                weaponProfile: { ...nextProfile, ammo: newAmmo }
            });
        }

        static async #onClearMalfunction() {
            const sys = this.session;
            if (!sys || sys.isResolved || sys.combatPhase !== "attack") return;
            const attacker = sys.participants?.find((p) => p.key === "attacker");
            const attActor = SessionStore.resolveActor(attacker);
            const weapon = this.#resolveWeapon(attActor, sys);
            if (!attActor || !weapon) return;

            const mechSkill =
                CoC7DataMapper.findActorSkill(attActor, { name: game.i18n.localize("ROE_COC7.Ranged.RepairSkillMech") }) ??
                CoC7DataMapper.findActorSkill(attActor, { id: weapon.system?.skill?.main?.id, name: weapon.system?.skill?.main?.name });
            const targetVal = mechSkill ? CoC7DataMapper.getSkillValue(mechSkill) : Number(attacker?.targetValue ?? 25);

            const roll = await new Roll("1d100").evaluate();
            const total = roll.total === 0 ? 100 : roll.total;
            const level = CoC7CheckResolver.evaluateResult(total, targetVal);
            const fixed = (CoC7CheckResolver.LEVEL_RANK[level] ?? 0) >= 2;

            if (fixed) {
                await CoC7DataMapper.setWeaponMalfunction(weapon, false);
                ui.notifications?.info(game.i18n.format("ROE_COC7.Ranged.MalfunctionCleared", { roll: total, target: targetVal }));
            } else {
                ui.notifications?.warn(game.i18n.format("ROE_COC7.Ranged.MalfunctionClearFailed", { roll: total, target: targetVal }));
            }

            const nextProfile = CoC7DataMapper.getWeaponCombatProfile(weapon, Number(attacker?.targetValue ?? 0));
            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, {
                rangedMalfunction: !fixed,
                rangedShotsFired: Number(sys.rangedShotsFired ?? 0) + 1,
                weaponProfile: { ...nextProfile, isJammed: !fixed }
            });
        }

        static async #onSwitchRangedTarget() {
            const sys = this.session;
            if (!sys || sys.isResolved || sys.combatPhase !== "attack" || sys.rangedFireMode !== "auto") return;
            const newTargetToken = game.user.targets.first() ?? null;
            const newTargetActor = newTargetToken?.actor ?? null;
            if (!newTargetActor) {
                ui.notifications?.warn(game.i18n.localize("ROE_COC7.Warnings.RangedNeedsTarget"));
                return;
            }

            const currentTarget = sys.participants?.find((p) => p.key === "defender");
            const currentTargetActor = currentTarget ? SessionStore.resolveActor(currentTarget) : null;
            const dist = CoC7DataMapper.measureTokenDistance(currentTargetActor, newTargetToken);
            const wastedBullets = Math.max(1, Math.floor(dist ?? 1));

            const attacker = sys.participants?.find((p) => p.key === "attacker");
            const attActor = SessionStore.resolveActor(attacker);
            const weapon = this.#resolveWeapon(attActor, sys);
            const newAmmo = await CoC7DataMapper.consumeWeaponAmmo(weapon, wastedBullets);

            const updatedDefender = {
                ...SessionStore.buildParticipant("defender", newTargetActor, game.i18n.localize("ROE_COC7.Ranged.Phases.Reaction"), 0),
                hasRolled: true,
                tookCover: false
            };

            const nextParticipants = sys.participants.map((p) => (p.key === "defender" ? updatedDefender : p));
            const nextShots = [
                ...(sys.rangedShots ?? []),
                {
                    index: (sys.rangedShots?.length ?? 0) + 1,
                    isTargetSwitch: true,
                    targetName: newTargetActor.name,
                    bulletsSpent: wastedBullets,
                    hits: 0,
                    impales: 0
                }
            ];

            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, {
                participants: nextParticipants,
                rangedShots: nextShots,
                rangedBulletsSpent: Number(sys.rangedBulletsSpent ?? 0) + wastedBullets,
                ...(newAmmo !== null ? { weaponProfile: { ...(sys.weaponProfile ?? {}), ammo: newAmmo } } : {})
            });
        }
        static async #onFinishRangedAttack() {
            const sys = this.session;
            const attacker = sys?.participants?.find((p) => p.key === "attacker");
            if (!attacker || attacker.hasRolled || sys.isResolved || sys.combatPhase !== "attack") return;
            const shots = sys.rangedShots ?? [];
            if (!shots.length) return;

            const lastShot = shots[shots.length - 1];
            const bestLevel = this.#resolveBestShotSuccessLevel(shots);
            const anyHit = (sys.rangedHits?.length ?? 0) > 0;

            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "attacker", {
                total: lastShot.total ?? 100,
                successLevel: bestLevel,
                isSuccess: anyHit,
                modifierDice: lastShot.modifierDice ?? 0,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id,
                rollBreakdown: lastShot.rollBreakdown ?? null
            });
        }

        static async #onRollAttack() {
            const sys = SessionStore.getSession(game.messages.get(this._messageId)) ?? this.session;
            const attacker = sys?.participants?.find((p) => p.key === "attacker");
            const target = sys?.participants?.find((p) => p.key === "defender");
            if (!attacker || attacker.hasRolled || sys.isResolved || sys.combatPhase !== "attack") return;

            const attActor = SessionStore.resolveActor(attacker);
            const weapon = this.#resolveWeapon(attActor, sys);
            const targetValue = Number(attacker.targetValue);
            const profile = CoC7DataMapper.getWeaponCombatProfile(weapon, targetValue);
            if (sys.rangedMalfunction || profile.isJammed) return;

            const fireMode = sys.rangedFireMode || "single";
            const shotsFired = Number(sys.rangedShotsFired ?? 0);
            const volleyIndex = Number(sys.rangedVolleyIndex ?? 0);
            const bulletsNeeded = this.#getBulletsForNextAction(fireMode, profile);
            if (profile.tracksAmmo && profile.ammo < bulletsNeeded) return;

            const rawMod = CoC7SessionPatcher.computeRangedModifierDice(sys, attacker, { fireMode, shotIndex: shotsFired, volleyIndex });
            const modifierDice = Math.clamp(rawMod, -2, 2);
            const requiredDifficulty = CoC7SessionPatcher.computeRangedRequiredDifficulty(sys, rawMod);
            const requiredRank = CoC7CheckResolver.LEVEL_RANK[requiredDifficulty] ?? 2;

            const roll = await new Roll(CoC7CheckResolver.buildRollFormula(modifierDice)).evaluate();
            const total = roll.total === 0 ? 100 : roll.total;
            const malfunction = profile.malfunctionThreshold > 0 && total >= profile.malfunctionThreshold;
            const successLevel = malfunction ? "fumble" : CoC7CheckResolver.evaluateResult(total, targetValue);
            const levelRank = CoC7CheckResolver.LEVEL_RANK[successLevel] ?? 0;
            const isHit = !malfunction && levelRank >= requiredRank;

            const newAmmo = await CoC7DataMapper.consumeWeaponAmmo(weapon, bulletsNeeded);
            if (malfunction) {
                await CoC7DataMapper.setWeaponMalfunction(weapon, true);
            }

            const { hits, impales } = this.#computeHitsForShot({
                isHit,
                successLevel,
                fireMode,
                bulletsNeeded,
                isImpalingWeapon: profile.isImpaling
            });

            const tacticalFlags = Object.entries(sys.tacticalFlags ?? {})
                .filter(([, active]) => Boolean(active))
                .map(([key]) => key);
            if (target?.tookCover && !tacticalFlags.includes("cover")) tacticalFlags.push("cover");

            const rollBreakdown = CoC7CheckResolver.buildBreakdown(roll, targetValue, successLevel, {
                modifierDice,
                tacticalFlags
            });

            const shotEntry = {
                index: (sys.rangedShots?.length ?? 0) + 1,
                fireMode,
                targetKey: target?.key ?? "defender",
                targetActorId: target?.actorId ?? "",
                targetName: target?.actorName ?? "",
                total,
                successLevel,
                isHit,
                malfunction,
                bulletsSpent: bulletsNeeded,
                hits,
                impales,
                modifierDice,
                rollBreakdown
            };

            const nextHits = [...(sys.rangedHits ?? [])];
            const dmgFormula = this.#resolveRangeDamageFormula(sys, profile);
            for (let i = 0; i < hits; i++) {
                nextHits.push({
                    targetActorId: target?.actorId ?? "",
                    targetName: target?.actorName ?? "",
                    impale: i < impales,
                    formula: dmgFormula
                });
            }

            const nextShots = [...(sys.rangedShots ?? []), shotEntry];
            const nextShotsFired = shotsFired + 1;
            const nextVolleyIndex = fireMode === "auto" ? volleyIndex + 1 : volleyIndex;
            const nextBulletsSpent = Number(sys.rangedBulletsSpent ?? 0) + bulletsNeeded;

            const tempSession = {
                ...sys,
                rangedShotsFired: nextShotsFired,
                rangedReloadedInRound: sys.rangedReloadedInRound
            };
            const remainingCapacity = this.#getRemainingRoundCapacity(tempSession, profile);
            const nextBulletsNeeded = this.#getBulletsForNextAction(fireMode, profile);
            const canContinue = !malfunction && remainingCapacity > 0 && (!profile.tracksAmmo || (newAmmo ?? 0) >= nextBulletsNeeded);

            const shotKey = `shot_${nextShots.length}`;
            const shotParticipant = {
                key: shotKey,
                actorId: attacker.actorId,
                actorName: attacker.actorName,
                label: `#${nextShots.length}`,
                hasRolled: true,
                total,
                targetValue,
                successLevel,
                isSuccess: isHit,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id,
                rollBreakdown,
                isShotDetail: true
            };
            const updatedParticipants = [...sys.participants, shotParticipant];

            const patch = {
                participants: updatedParticipants,
                rangedShots: nextShots,
                rangedHits: nextHits,
                rangedShotsFired: nextShotsFired,
                rangedBulletsSpent: nextBulletsSpent,
                rangedVolleyIndex: nextVolleyIndex,
                rangedMalfunction: malfunction,
                weaponProfile: {
                    ...profile,
                    ...(newAmmo !== null ? { ammo: newAmmo } : {}),
                    isJammed: malfunction
                }
            };

            await UniversalRollOrchestrator.updateSessionPatch(this._messageId, patch);

            if (!canContinue) {
                const bestLevel = this.#resolveBestShotSuccessLevel(nextShots);
                await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "attacker", {
                    total,
                    successLevel: bestLevel,
                    isSuccess: nextHits.length > 0,
                    modifierDice,
                    rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                    rollerUserId: game.user.id,
                    rollBreakdown
                });
            }
        }

        #computeHitsForShot({ isHit, successLevel, fireMode, bulletsNeeded, isImpalingWeapon }) {
            if (!isHit) return { hits: 0, impales: 0 };
            const isExtremeOrCrit = successLevel === "extreme" || successLevel === "critical";

            if (fireMode === "burst" || fireMode === "auto") {
                if (isExtremeOrCrit) {
                    const hits = bulletsNeeded;
                    const impales = isImpalingWeapon ? Math.max(1, Math.floor(hits / 2)) : 0;
                    return { hits, impales };
                }
                const hits = Math.max(1, Math.floor(bulletsNeeded / 2));
                return { hits, impales: 0 };
            }

            return {
                hits: 1,
                impales: isExtremeOrCrit && isImpalingWeapon ? 1 : 0
            };
        }

        #resolveRangeDamageFormula(sys, profile) {
            if (sys.rangedRangeTier === "extreme") return profile.extremeDamage || sys.damageFormula;
            if (sys.rangedRangeTier === "long") return profile.longDamage || sys.damageFormula;
            return profile.normalDamage || sys.damageFormula;
        }

        #resolveBestShotSuccessLevel(shots) {
            const rank = CoC7CheckResolver.LEVEL_RANK;
            let best = "failure";
            for (const s of shots) {
                if (s.isTargetSwitch) continue;
                if ((rank[s.successLevel] ?? 0) > (rank[best] ?? 0)) best = s.successLevel;
            }
            return best;
        }

        static async #onExecuteDamageRoll() {
            await DamageRollSubmitter.submit(this._messageId);
        }
    };
}
