import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7PromptPresenter } from "../module/coc7/adapter/coc7-prompt-presenter.mjs";
import { CombatRollStrategy } from "../module/coc7/strategies/combat-roll-strategy.mjs";
import { CombatConsequenceApplier } from "../module/coc7/strategies/combat-consequence-applier.mjs";
import { createCombatPromptApp } from "../module/coc7/prompts/combat-prompt-app.mjs";
import { CoC7Adapter } from "../module/coc7/coc7-adapter.mjs";

globalThis.game = {
    user: { isGM: true },
    settings: { get: () => undefined },
    i18n: { localize: (key) => key, format: (key) => key }
};

const actors = new Map();
const coreApi = {
    visibility: { canViewParticipantRoll: (participant) => participant.visible !== false },
    session: { resolveActor: (participant) => actors.get(participant.key) },
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
    const prompt = presenter.preparePromptContext(null, session, {});
    const chat = presenter.prepareResolvedChatContext(session);
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
assert.equal(presenter.preparePromptContext(null, noTarget, {}).resolvedDamageTargetName, "ROE_COC7.Combat.UnknownTarget");
assert.equal(presenter.preparePromptContext(null, noTarget, {}).resolvedHasDamage, true);

const hidden = { ...noTarget, participants: [attacker, defender, { ...damage, visible: false }] };
const hiddenContext = presenter.preparePromptContext(null, hidden, {});
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
assert.equal(gmContext.canDecideDamage, true);
assert.equal(gmContext.canResolve, false);
game.user.isGM = false;
previewTarget.isOwner = true;
const playerContext = await combatPrompt._prepareContext({});
assert.equal(playerContext.damagePreviewLabel, "");
assert.equal(playerContext.damagePreviewHp, undefined);
assert.equal(playerContext.canDecideDamage, false);
game.user.isGM = true;

const adapter = new CoC7Adapter();
const legacyMelee = { ...meleeState, pendingDamageKey: "" };
assert.equal(adapter.canResolveSession(legacyMelee), false);
const declinedLegacy = await adapter.handleConsequenceDecision(legacyMelee, { action: "decline", participantKey: "damage" });
assert.equal(declinedLegacy.consequencesApplied, true);
assert.equal(previewTarget.system.attribs.hp.value, 7);
game.messages = new Map([["message", {}]]);
coreApi.session.getSession = () => meleeState;
coreApi.orchestrator = {
    async submitConsequenceDecision(_id, decision) {
        meleeState = await adapter.handleConsequenceDecision(meleeState, decision);
    }
};
assert.equal(adapter.canResolveSession(meleeState), false);
await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(combatPrompt, null, { dataset: { decision: "decline" } });
assert.equal(meleeState.pendingDamageKey, "");
assert.equal(meleeState.consequencesApplied, true);
assert.equal(previewTarget.system.attribs.hp.value, 7);
assert.equal(adapter.canResolveSession(meleeState), true);

previewTarget.statuses.clear();
previewTarget.update = async function (data) { this.system.attribs.hp.value = data["system.attribs.hp.value"]; };
const autoMeleeState = {
    participants: [attacker, defender, damage], hitWinnerKey: "attacker", combatPhase: "resolution",
    rollType: "combat", consequencesApplied: false
};
game.settings.get = (_module, key) => key === "autoApplyRollConsequences";
await new CombatRollStrategy().onRollApplied({ key: "damage", hasRolled: true, total: 3 }, autoMeleeState);
assert.equal(previewTarget.system.attribs.hp.value, 5);
assert.equal(autoMeleeState.pendingDamageKey, "");
assert.equal(autoMeleeState.consequencesApplied, true);

game.settings.get = () => false;
const absorbedState = {
    participants: [attacker, defender, damage], hitWinnerKey: "attacker", combatPhase: "resolution",
    rollType: "combat", consequencesApplied: false
};
await new CombatRollStrategy().onRollApplied({ key: "damage", hasRolled: true, total: 1 }, absorbedState);
assert.equal(absorbedState.finalDamage, 0);
assert.equal(absorbedState.pendingDamageKey, "damage");
assert.equal(adapter.canResolveSession(absorbedState), false);
const appliedZero = await adapter.handleConsequenceDecision(absorbedState, { action: "apply", participantKey: "damage" });
const declinedZero = await adapter.handleConsequenceDecision(absorbedState, { action: "decline", participantKey: "damage" });
assert.deepEqual(appliedZero, declinedZero);
assert.equal(previewTarget.system.attribs.hp.value, 5);
console.log("Combat damage recipient checks passed.");
