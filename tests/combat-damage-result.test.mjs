import assert from "assert";
import { describe, it } from "vitest";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7PromptPresenter } from "../module/coc7/adapter/coc7-prompt-presenter.mjs";
import { CombatRollStrategy } from "../module/coc7/strategies/combat-roll-strategy.mjs";
import { CombatConsequenceApplier } from "../module/coc7/strategies/combat-consequence-applier.mjs";
import { createCombatPromptApp } from "../module/coc7/prompts/combat-prompt-app.mjs";
import { CoC7Adapter } from "../module/coc7/coc7-adapter.mjs";
import { DamageRollSubmitter } from "../module/coc7/prompts/damage-roll-submitter.mjs";

describe("Combat damage results and impale evaluation", () => {
    it("resolves damage recipients, previews, decisions, and impale dice", async () => {
        globalThis.game = {
            user: { isGM: true },
            settings: { get: () => undefined },
            i18n: { localize: (key) => key, format: (key) => key }
        };

        const actors = new Map();
        const coreApi = {
            visibility: { canViewParticipantRoll: (participant) => participant.visible !== false },
            session: { resolveActor: (participant) => actors.get(participant.key) ?? actors.get(participant.actorId) },
            diceVisualizer: { getDiceVisuals: () => [] }
        };
        setCoreApi(coreApi);

        const presenter = new CoC7PromptPresenter({});
        const attacker = { key: "attacker", actorName: "Attacker", hasRolled: true };
        const defender = { key: "defender", actorName: "Defender", hasRolled: true };
        const damage = { key: "damage", hasRolled: true };

        for (const [rollType, winnerKey, expectedName] of [
            ["combat", "attacker", "Defender"],
            ["combat", "defender", "Attacker"],
            ["ranged", "attacker", "Defender"]
        ]) {
            const session = {
                rollType, isResolved: true, hitWinnerKey: winnerKey,
                participants: [attacker, defender, damage], finalDamage: 2
            };
            const prompt = await presenter.preparePromptContext(null, session, {});
            const chat = await presenter.prepareResolvedChatContext(session);
            assert.equal(prompt.resolvedDamageTargetName, expectedName);
            assert.equal(chat.resolvedDamageTargetName, expectedName);
            assert.equal(CombatRollStrategy.getDamageTarget(session).actorName, expectedName);

            let updatedKey;
            for (const participant of [attacker, defender]) {
                actors.set(participant.key, {
                    system: { attribs: { hp: { value: 10, max: 10 } } },
                    update: async () => { updatedKey = participant.key; }
                });
            }
            await new CombatRollStrategy().applyConsequences(session);
            assert.equal(actors.get(updatedKey), actors.get(CombatRollStrategy.getDamageTarget(session).key));
        }

        const noTarget = {
            rollType: "combat", isResolved: true, hitWinnerKey: "attacker",
            participants: [attacker, damage], finalDamage: 0
        };
        assert.equal((await presenter.preparePromptContext(null, noTarget, {})).resolvedDamageTargetName, "ROE_COC7.Combat.UnknownTarget");
        assert.equal((await presenter.preparePromptContext(null, noTarget, {})).resolvedHasDamage, true);

        const hidden = { ...noTarget, participants: [attacker, defender, { ...damage, visible: false }] };
        const hiddenContext = await presenter.preparePromptContext(null, hidden, {});
        assert.equal(hiddenContext.resolvedCanViewDamage, false);
        assert.equal(hiddenContext.resolvedDamageTargetName, "");

        const previewTarget = {
            system: { attribs: { hp: { value: 7, max: 10 }, armor: { value: 1 } } },
            statuses: new Set(),
            update: async () => { throw new Error("Preview must not update the actor."); }
        };
        actors.set("defender", previewTarget);
        let meleeState = {
            participants: [attacker, defender, damage], hitWinnerKey: "attacker", combatPhase: "resolution",
            rollType: "combat", consequencesApplied: false
        };
        await new CombatRollStrategy().onRollApplied({ key: "damage", hasRolled: true, total: 6 }, meleeState);
        assert.equal(meleeState.pendingDamageKey, "damage");
        assert.equal(meleeState.hasPendingConsequences, true);
        assert.equal(meleeState.damagePreview, undefined);
        assert.equal(previewTarget.system.attribs.hp.value, 7);
        assert.equal(CombatConsequenceApplier.previewDamage(previewTarget, 7, false, false).unconscious, true);
        assert.equal(CombatConsequenceApplier.previewDamage(previewTarget, 10, false, true).dead, true);
        previewTarget.statuses.add("criticalWounds");
        assert.equal(CombatConsequenceApplier.previewDamage(previewTarget, 7, false, false).dying, true);
        const woundTarget = {
            system: { attribs: { hp: { value: 5, max: 10 } } },
            statuses: new Set(),
            async update(data) { this.system.attribs.hp.value = data["system.attribs.hp.value"]; },
            async toggleStatusEffect(status) { this.statuses.add(status); }
        };
        globalThis.Hooks = { callAll() { } };
        const woundPreview = CombatConsequenceApplier.previewDamage(woundTarget, 5, true, false);
        assert.equal(woundPreview.damage, 5);
        assert.equal(woundPreview.remainingHp, 0);
        assert.equal(woundPreview.majorWound, true);
        assert.equal(woundPreview.unconscious, true);
        assert.equal(woundPreview.dying, true);
        assert.equal(CombatConsequenceApplier.formatPreview(woundPreview),
            "ROE_COC7.DamagePreview.Dying; ROE_COC7.DamagePreview.MajorWoundStatus");
        assert.equal(woundTarget.system.attribs.hp.value, 5);
        assert.equal(woundTarget.statuses.size, 0);
        await CombatConsequenceApplier.applyDamageToActor(woundTarget, 5, true, false);
        assert.equal(woundTarget.system.attribs.hp.value, 0);
        assert.deepEqual([...woundTarget.statuses].sort(), ["criticalWounds", "dying", "unconscious"]);

        if (!Math.clamp) Math.clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        class TestCombatPrompt {
            constructor(session) { this.session = session; this._messageId = "message"; }
            async _prepareContext() { return { canResolve: true, canApplyConsequences: true }; }
            _isDelegatedToActivePlayer() { return false; }
            _formatModifierLabel(value) { return String(value); }
            _formatDiceFormulaLabel() { return ""; }
        }
        const Prompt = createCombatPromptApp({ extendPromptClass: (base) => base }, TestCombatPrompt);
        const combatPrompt = new Prompt(meleeState);
        const gmContext = await combatPrompt._prepareContext({});
        assert.equal(gmContext.damagePreviewHp, 2);
        assert.equal(gmContext.damagePreviewDamage, 5);
        assert.equal(gmContext.canDecideDamage, true);
        assert.equal(gmContext.canResolve, false);

        const adapter = new CoC7Adapter();
        game.messages = new Map([["message", {}]]);
        coreApi.session.getSession = () => meleeState;
        coreApi.orchestrator = {
            async submitConsequenceDecision(_id, decision) {
                meleeState = await adapter.handleConsequenceDecision(meleeState, decision);
            }
        };
        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(combatPrompt, null, { dataset: { decision: "decline" } });
        assert.equal(meleeState.pendingDamageKey, "");
        assert.equal(meleeState.consequencesApplied, true);

        // Verify CoC7 impale damage: base weapon damage + damage bonus maximized, extra weapon die rolled
        const impaleWeapon = {
            id: "wp-knife", name: "Hunting Knife", type: "weapon",
            system: { properties: { impl: true }, range: { normal: { damage: "1d6" } } }
        };
        const bluntWeapon = {
            id: "wp-club", name: "Club", type: "weapon",
            system: { properties: { impl: false }, range: { normal: { damage: "1d6" } } }
        };
        const impaleAttacker = {
            id: "att-imp", name: "Investigator",
            items: new Map([["wp-knife", impaleWeapon], ["wp-club", bluntWeapon]]),
            system: { attribs: { db: { value: "1d4" } } }
        };
        actors.set("att-imp", impaleAttacker);

        globalThis.foundry = { dice: { terms: { Die: class { } } } };
        globalThis.Roll = class {
            constructor(formula) { this.formula = formula; this.terms = []; this.total = 0; }
            async evaluate({ maximize = false } = {}) {
                if (this.formula === "1d6") this.total = maximize ? 6 : 3;
                else if (this.formula === "1d4") this.total = maximize ? 4 : 2;
                return this;
            }
        };

        let submittedDamage = null;
        coreApi.visibility.getCurrentRollMode = () => "publicroll";
        coreApi.orchestrator.submitParticipantRoll = async (_id, _key, data) => { submittedDamage = data; };

        const impaleSession = {
            rollType: "combat", combatType: "melee", hitWinnerKey: "attacker", damageBonus: "1d4",
            participants: [
                { key: "attacker", actorId: "att-imp", itemId: "wp-knife", successLevel: "extreme", hasRolled: true },
                { key: "damage", actorId: "att-imp", diceFormula: "1d6+1d6+1d4", hasRolled: false }
            ]
        };
        game.messages.set("msg-impale", { session: impaleSession });
        coreApi.session.getSession = (msg) => msg?.session ?? null;

        await DamageRollSubmitter.submit("msg-impale", "damage");
        assert.equal(submittedDamage.total, 13);

        const bluntSession = {
            rollType: "combat", combatType: "melee", hitWinnerKey: "attacker", damageBonus: "1d4",
            participants: [
                { key: "attacker", actorId: "att-imp", itemId: "wp-club", successLevel: "extreme", hasRolled: true },
                { key: "damage", actorId: "att-imp", diceFormula: "1d6+1d4", hasRolled: false }
            ]
        };
        game.messages.set("msg-blunt", { session: bluntSession });

        await DamageRollSubmitter.submit("msg-blunt", "damage");
        assert.equal(submittedDamage.total, 10);
    });
});
