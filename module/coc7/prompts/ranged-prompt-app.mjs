import { SessionStore, UniversalRollOrchestrator, RollVisibilityPolicy, DiceVisualizer } from "../../core-bridge.mjs";
import { DamageRollSubmitter } from "./damage-roll-submitter.mjs";
import { CoC7CheckResolver } from "../coc7-check-resolver.mjs";
import { CoC7ResultFormatter } from "../coc7-result-formatter.mjs";

const PHASE_ORDER = ["reaction", "attack", "resolution"];
const PENDING_PARTICIPANT_BY_PHASE = { reaction: "defender", attack: "attacker", resolution: "damage" };
const COVER_PENALTY_DICE = -1;

/**
 * Ranged attack prompt: target reaction, simple attack roll, then damage and consequences.
 */
const RANGED_PROMPT_TEMPLATE = "modules/narrative-rolls-and-effects-coc7/templates/systems/coc7/prompts/ranged-prompt.hbs";

/** Creates the ranged prompt and coordinates cover, attack, and damage actions. */
export function createRangedPromptApp(core, BasicPromptApp) {
    const ParentPromptApp = core.extendPromptClass(BasicPromptApp, { template: RANGED_PROMPT_TEMPLATE });
    return class RangedPromptApp extends ParentPromptApp {
        static DEFAULT_OPTIONS = {
            actions: {
                executeRoll: RangedPromptApp.#onRollAttack,
                chooseCover: RangedPromptApp.#onChooseCover,
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
            const tookCover = Boolean(target?.tookCover);
            const manualMod = Number(attacker?.modifierDice ?? 0);
            const coverPenalty = tookCover ? COVER_PENALTY_DICE : 0;
            // Taking cover contributes a penalty die to the attacker's manual modifier.
            const effectiveMod = Math.clamp(manualMod + coverPenalty, -2, 2);

            const isAttackerOwner = Boolean(this.#resolveActor(attacker)?.isOwner);
            const isTargetOwner = Boolean(this.#resolveActor(target)?.isOwner);
            const canViewAttackerRoll = attacker ? (isAttackerOwner || RollVisibilityPolicy.canViewParticipantRoll(attacker, sys)) : false;
            const canViewDamage = damageEntry ? RollVisibilityPolicy.canViewParticipantRoll(damageEntry, sys) : false;
            const damageActor = this.#resolveActor(damageEntry);
            const attackerDice = DiceVisualizer.getDiceVisuals({ rollType: "skill" }, effectiveMod);
            const damageDice = canViewDamage
                ? DiceVisualizer.getDiceVisuals({ rollType: "other", diceFormula: damageEntry?.diceFormula ?? sys.damageFormula })
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
                canActAsTarget: isGM || Boolean(this.#resolveActor(target)?.isOwner),
                isTargetDelegated: this._isDelegatedToActivePlayer(target),
                isAttackerDelegated: this._isDelegatedToActivePlayer(attacker),
                isDamageDelegated: this._isDelegatedToActivePlayer(damageEntry),
                canRollAttack: phase === "attack" && Boolean(attacker && !attacker.hasRolled) &&
                    (isGM || Boolean(this.#resolveActor(attacker)?.isOwner)),
                targetTookCover: tookCover,
                coverResultText: target?.hasRolled
                    ? game.i18n.localize(tookCover ? "ROE_COC7.Ranged.CoverTaken" : "ROE_COC7.Ranged.NoCover")
                    : "",

                manualModifierDice: manualMod,
                flagModifierDice: coverPenalty,
                effectiveModifierDice: effectiveMod,
                effectiveModifierLabel: this._formatModifierLabel(effectiveMod),
                attackerDice,
                attackerDiceLabel: this._formatDiceFormulaLabel(attackerDice),
                damageDice,
                damageDiceLabel: canViewDamage ? this._formatDiceFormulaLabel(damageDice) : "",
                attackerRollBtnLabel: `${attacker?.label ?? ""} (${attacker?.targetValue ?? 0}%)`,
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

        static async #onRollAttack() {
            const sys = this.session;
            const attacker = sys?.participants?.find((p) => p.key === "attacker");
            const target = sys?.participants?.find((p) => p.key === "defender");
            if (!attacker || attacker.hasRolled || sys.isResolved || sys.combatPhase !== "attack") return;

            const coverPenalty = target?.tookCover ? COVER_PENALTY_DICE : 0;
            const modifierDice = Math.clamp(Number(attacker.modifierDice ?? 0) + coverPenalty, -2, 2);
            const targetValue = Number(attacker.targetValue);

            const roll = await new Roll(CoC7CheckResolver.buildRollFormula(modifierDice)).evaluate();
            const total = roll.total === 0 ? 100 : roll.total;
            const successLevel = CoC7CheckResolver.evaluateResult(total, targetValue);
            const rank = CoC7CheckResolver.LEVEL_RANK;

            await UniversalRollOrchestrator.submitParticipantRoll(this._messageId, "attacker", {
                total,
                successLevel,
                isSuccess: (rank[successLevel] ?? 0) >= (rank[sys.difficulty] ?? 2),
                modifierDice,
                rollMode: RollVisibilityPolicy.getCurrentRollMode(),
                rollerUserId: game.user.id,
                rollBreakdown: CoC7CheckResolver.buildBreakdown(roll, targetValue, successLevel, {
                    modifierDice,
                    tacticalFlags: target?.tookCover ? ["cover"] : []
                })
            });
        }

        static async #onExecuteDamageRoll() {
            await DamageRollSubmitter.submit(this._messageId);
        }
    };
}

