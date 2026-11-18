import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { RangedWeaponService } from "../module/coc7/ranged/ranged-weapon-service.mjs";
import { RangedCombatRules } from "../module/coc7/ranged/ranged-combat-rules.mjs";
import { CoC7SessionFactory } from "../module/coc7/coc7-session-factory.mjs";
import { RangedRollStrategy } from "../module/coc7/strategies/ranged-roll-strategy.mjs";
import { CoC7SessionPatcher } from "../module/coc7/adapter/coc7-session-patcher.mjs";
import { DamageRollSubmitter } from "../module/coc7/prompts/damage-roll-submitter.mjs";
import { createRangedPromptApp } from "../module/coc7/prompts/ranged-prompt-app.mjs";
import { CoC7CombatResultPresenter } from "../module/coc7/adapter/coc7-combat-result-presenter.mjs";

if (!Math.clamp) Math.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const actors = new Map();
globalThis.game = {
    user: { isGM: true, targets: { first: () => null } },
    actors,
    settings: {
        settings: new Map(),
        get: () => false
    },
    i18n: {
        localize: (key) => key,
        format: (key) => key
    }
};

const coreApi = {
    session: {
        buildParticipant: (key, actor, label, targetValue, itemId = "") => ({
            key, actorId: actor?.id ?? "", actorName: actor?.name ?? "", actorImg: "",
            label, targetValue, itemId, hasRolled: false, total: null, successLevel: "", isSuccess: false
        }),
        resolveActor: (participant) => actors.get(participant?.actorId) ?? null
    }
};
setCoreApi(coreApi);

// 1. Weapon profile & immediate ammo/malfunction updates
let weaponAmmo = 6;
const weaponFlags = new Map();
const revolver = {
    id: "w1",
    name: ".38 Revolver",
    system: {
        ammo: weaponAmmo,
        bullets: 6,
        malfunction: 98,
        usesPerRound: { min: 1, max: 3, burst: 0 },
        properties: { rngd: true, impl: true },
        range: { normal: { value: 15, damage: "1d10" }, long: { value: 30, damage: "1d10" }, extreme: { value: 60, damage: "1d10" } }
    },
    update: async (data) => {
        if ("system.ammo" in data) {
            weaponAmmo = data["system.ammo"];
            revolver.system.ammo = weaponAmmo;
        }
    },
    getFlag: (_mod, key) => weaponFlags.get(key),
    setFlag: async (_mod, key, val) => { weaponFlags.set(key, val); },
    unsetFlag: async (_mod, key) => { weaponFlags.delete(key); }
};

const profile = RangedWeaponService.getWeaponCombatProfile(revolver, 60);
assert.equal(profile.tracksAmmo, true);
assert.equal(profile.ammo, 6);
assert.equal(profile.maxUses, 3);
assert.deepEqual(profile.fireModes, ["single", "multiple"]);

await RangedWeaponService.consumeWeaponAmmo(revolver, 2);
assert.equal(revolver.system.ammo, 4);

await RangedWeaponService.reloadWeapon(revolver);
assert.equal(revolver.system.ammo, 6);

await RangedWeaponService.setWeaponMalfunction(revolver, true);
assert.equal(RangedWeaponService.getWeaponCombatProfile(revolver, 60).isJammed, true);
await RangedWeaponService.setWeaponMalfunction(revolver, false);
assert.equal(RangedWeaponService.getWeaponCombatProfile(revolver, 60).isJammed, false);
// 2. Modifier & difficulty progression for multiple shots and full-auto volleys
const attackerActor = { id: "a1", name: "Investigator", system: { characteristics: { dex: { value: 60 } }, attribs: { hp: { value: 12, max: 12 } } } };
const defenderActor = { id: "d1", name: "Cultist", system: { attribs: { hp: { value: 10, max: 10 }, armor: { value: 2 }, build: { value: 0 } } } };
actors.set("a1", attackerActor);
actors.set("d1", defenderActor);

const session = CoC7SessionFactory.createRanged({
    attacker: attackerActor,
    target: defenderActor,
    weapon: revolver,
    attackSkillLabel: "Handguns",
    attackTargetValue: 60,
    rangeTier: "long"
});
assert.equal(session.difficulty, "hard");

const attPart = session.participants[0];
assert.equal(RangedCombatRules.computeModifierDice(session, attPart, { fireMode: "multiple", shotIndex: 0 }), 0);
assert.equal(RangedCombatRules.computeModifierDice(session, attPart, { fireMode: "multiple", shotIndex: 1 }), -1);

// Full auto volley overflow into difficulty escalation
const rawVolley3 = RangedCombatRules.computeModifierDice(session, attPart, { fireMode: "auto", volleyIndex: 3 });
assert.equal(rawVolley3, -3);
assert.equal(RangedCombatRules.computeRequiredDifficulty(session, rawVolley3), "extreme");

// 3. Per-bullet armor mitigation & major wound on multi-hit damage
const strategy = new RangedRollStrategy();
const damageState = {
    ...session,
    hitWinnerKey: "attacker",
    rangedHitResults: [
        { targetActorId: "d1", rawDamage: 4, impale: false },
        { targetActorId: "d1", rawDamage: 7, impale: true }
    ]
};
await strategy.onRollApplied({ key: "damage", hasRolled: true, total: 11 }, damageState);
assert.equal(damageState.finalDamage, 7);
assert.equal(damageState.armorApplied, 4);
assert.equal(damageState.majorWoundTriggered, true);

// 4. Token distance & automatic tactical detection
globalThis.canvas = {
    grid: {
        measurePath: () => ({ distance: 2 })
    },
    tokens: {
        placeables: [
            { id: "tAtt", actor: attackerActor, center: { x: 0, y: 0 }, document: { disposition: 1 } },
            { id: "tDef", actor: defenderActor, center: { x: 100, y: 0 }, document: { disposition: -1 } },
            { id: "tAlly", actor: { id: "a2" }, center: { x: 100, y: 100 }, document: { disposition: 1 } }
        ]
    }
};
const detected = RangedWeaponService.detectRangedContext(attackerActor, defenderActor, revolver);
assert.equal(detected.distance, 2);
assert.equal(detected.tacticalFlags.pointBlank, true);
assert.equal(detected.tacticalFlags.inMelee, true);

console.log("Ranged combat rules checks passed.");

// Full-auto volleys retain their own targets and leave damage pending until cease fire.
const secondTarget = { id: "d2", name: "Guard", system: { attribs: { hp: { value: 10, max: 10 }, armor: { value: 1 } } } };
actors.set(secondTarget.id, secondTarget);
const autoWeapon = {
    id: "auto", name: "Automatic weapon",
    system: {
        ammo: 16, bullets: 16, malfunction: 98, properties: { rngd: true, auto: true, impl: true },
        range: { normal: { damage: "1d6" } }
    },
    update: async function (data) { this.system.ammo = data["system.ammo"]; },
    setFlag: async function () { this.jammed = true; },
    unsetFlag: async function () { this.jammed = false; }
};
attackerActor.items = new Map([[autoWeapon.id, autoWeapon]]);
const firstToken = { id: "first", actor: defenderActor, center: { x: 0, y: 0 } };
const secondToken = { id: "second", actor: secondTarget, center: { x: 3, y: 0 } };
canvas.scene = { grid: { units: "m", distance: 1 } };
canvas.tokens.placeables = [firstToken, secondToken];
canvas.grid.measurePath = ([a, b]) => ({ distance: Math.abs(a.x - b.x) });
let autoState = CoC7SessionFactory.createRanged({
    attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
    attackSkillLabel: "Firearms", attackTargetValue: 60
});
autoState.combatPhase = "attack";
autoState.rangedFireMode = "auto";
autoState.participants[1].hasRolled = true;
let shooter = autoState.participants[0];
const patcher = new CoC7SessionPatcher();
assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: 0 }), true);
Object.assign(shooter, { hasRolled: true, total: 40, successLevel: "regular", rollBreakdown: { modifierDice: 0 } });
assert.deepEqual(await strategy.onRollApplied(shooter, autoState), []);
assert.equal(autoState.combatPhase, "attack");
assert.equal(shooter.hasRolled, false);
assert.equal(autoWeapon.system.ammo, 10);
assert.equal(autoState.volleyLog[0].roundsHit, 3);

autoState = patcher.transformSessionPatch(autoState, { switchRangedTarget: "second" });
shooter = autoState.participants[0];
assert.equal(autoState.traversePenaltyDice, 1);
assert.equal(RangedCombatRules.computeModifierDice(autoState, shooter), -2);
assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: -1 }), false);
assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: -2 }), true);
Object.assign(shooter, { hasRolled: true, total: 10, successLevel: "extreme", rollBreakdown: { modifierDice: -2 } });
assert.deepEqual(await strategy.onRollApplied(shooter, autoState), []);
assert.equal(autoWeapon.system.ammo, 4);
assert.equal(autoState.volleyLog[1].roundsHit, 6);
assert.equal(autoState.rangedHits.filter((hit) => hit.targetKey === "second" && hit.impale).length, 3);
const excessiveTraverse = patcher.transformSessionPatch(autoState, { switchRangedTarget: "first" });
assert.equal(patcher.validateSubmittedRoll(excessiveTraverse, shooter, { modifierDice: -2 }), false);
autoState = patcher.transformSessionPatch(autoState, { stopAutoFire: true });
assert.equal(autoState.combatPhase, "resolution");
assert.equal(autoState.autoFireEnded, true);
assert.equal(autoState.participants.find((entry) => entry.key === "attacker").hasRolled, true);
assert.deepEqual(autoState.participants.filter((entry) => entry.key.startsWith("damage")).map((entry) => entry.targetKey), ["first", "second"]);

// Each target's damage is rolled independently while preserving prior hit results.
game.messages = new Map([["message", {}]]);
coreApi.session.getSession = () => autoState;
coreApi.visibility = { getCurrentRollMode: () => "publicroll", canViewParticipantRoll: () => true };
async function submitDamage(_id, key, data) {
    const participant = autoState.participants.find((entry) => entry.key === key);
    Object.assign(participant, data, { hasRolled: true });
    await strategy.onRollApplied(participant, autoState);
}
coreApi.orchestrator = {
    updateSessionPatch: async (_id, patch) => Object.assign(autoState, patch),
    submitParticipantRoll: submitDamage
};
globalThis.foundry = { dice: { terms: { Die: class {} } } };
globalThis.Roll = class {
    constructor(formula) { this.formula = formula; this.terms = []; }
    async evaluate(options = {}) { this.total = options.maximize ? 6 : 4; return this; }
};
await DamageRollSubmitter.submit("message", "damage");
assert.equal(autoState.rangedHitResults.length, 3);
await DamageRollSubmitter.submit("message", "damage_1");
assert.equal(autoState.rangedHitResults.length, 9);
assert.equal(autoState.rangedDamageByActor.d1.damage, 6);
assert.equal(autoState.rangedDamageByActor.d2.damage, 24);
assert.throws(() => RangedCombatRules.evaluateMultiHitDamage([{ targetActorId: "missing", rawDamage: 4 }], defenderActor));
const resolvedContext = CoC7CombatResultPresenter.buildResolvedContext(autoState);
assert.deepEqual(resolvedContext.resolvedRangedDamage.map((entry) => [entry.name, entry.damage]), [["Cultist", 6], ["Guard", 24]]);

// A partial final volley is legal, and a later malfunction cannot erase earlier hits.
autoWeapon.system.ammo = 10;
let jamState = CoC7SessionFactory.createRanged({
    attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
    attackSkillLabel: "Firearms", attackTargetValue: 60
});
jamState.combatPhase = "attack";
jamState.rangedFireMode = "auto";
jamState.participants[1].hasRolled = true;
const jamShooter = jamState.participants[0];
Object.assign(jamShooter, { hasRolled: true, total: 30, successLevel: "hard" });
await strategy.onRollApplied(jamShooter, jamState);
Object.assign(jamShooter, { hasRolled: true, total: 99, successLevel: "fumble" });
const jamDamage = await strategy.onRollApplied(jamShooter, jamState);
assert.equal(jamState.volleyLog[1].roundsFired, 4);
assert.equal(autoWeapon.system.ammo, 0);
assert.equal(autoWeapon.jammed, true);
assert.equal(jamState.combatPhase, "resolution");
assert.equal(jamState.hitWinnerKey, "attacker");
assert.equal(jamDamage.length, 1);

autoWeapon.system.ammo = 7;
const depletedState = CoC7SessionFactory.createRanged({
    attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
    attackSkillLabel: "Firearms", attackTargetValue: 60
});
depletedState.combatPhase = "attack";
depletedState.rangedFireMode = "auto";
depletedState.participants[1].hasRolled = true;
const depletedShooter = depletedState.participants[0];
Object.assign(depletedShooter, { hasRolled: true, total: 40, successLevel: "regular" });
assert.equal((await strategy.onRollApplied(depletedShooter, depletedState)).length, 1);
assert.equal(depletedState.combatPhase, "resolution");
assert.equal(depletedState.remainingAmmo, 1);

canvas.scene.grid.units = "ft";
secondToken.center.x = 10;
assert.equal(RangedCombatRules.measureTraverse(firstToken, secondToken).penalty, 1);
secondToken.center.x = 8.99;
assert.equal(RangedCombatRules.measureTraverse(firstToken, secondToken).penalty, 0);
secondToken.center.x = 10;
canvas.grid.measurePath = () => ({});
canvas.grid.measureDistance = () => 10;
assert.equal(RangedCombatRules.measureTraverse(firstToken, secondToken).penalty, 1);
canvas.grid.measurePath = ([a, b]) => ({ distance: Math.abs(a.x - b.x) });

const nestedAmmoWeapon = {
    system: { data: { ammo: 3 }, properties: { auto: true } },
    update: async function (data) { this.system.data.ammo = data["system.data.ammo"]; }
};
assert.equal(RangedWeaponService.getWeaponCombatProfile(nestedAmmoWeapon, 30).ammo, 3);
await RangedWeaponService.consumeWeaponAmmo(nestedAmmoWeapon, 3);
assert.equal(RangedWeaponService.getWeaponCombatProfile(nestedAmmoWeapon, 30).ammo, 0);
assert.equal(RangedWeaponService.getWeaponCombatProfile(nestedAmmoWeapon, 30).tracksAmmo, true);

// Exercise the actual prompt handlers and the cease-fire session patch.
if (!String.prototype.capitalize) String.prototype.capitalize = function () { return this.charAt(0).toUpperCase() + this.slice(1); };
class TestPrompt {
    constructor(session) { this.session = session; this._messageId = "message"; }
    async _prepareContext() { return {}; }
    _isDelegatedToActivePlayer() { return false; }
    _formatModifierLabel(value) { return String(value); }
    _formatDiceFormulaLabel() { return ""; }
}
const Prompt = createRangedPromptApp({ extendPromptClass: (base) => base }, TestPrompt);
coreApi.visibility.canViewParticipantRoll = () => true;
coreApi.diceVisualizer = { getDiceVisuals: () => [] };
async function submitPromptRoll(_id, key, data) {
    const participant = autoState.participants.find((entry) => entry.key === key);
    assert.equal(patcher.validateSubmittedRoll(autoState, participant, data), true);
    Object.assign(participant, data, { hasRolled: true });
    const followUps = await strategy.onRollApplied(participant, autoState);
    autoState.participants.push(...followUps);
}
coreApi.orchestrator.submitParticipantRoll = submitPromptRoll;
coreApi.orchestrator.updateSessionPatch = async (_id, patch) => {
    autoState = patcher.transformSessionPatch(autoState, patch);
};
autoWeapon.system.ammo = 12;
autoState = CoC7SessionFactory.createRanged({
    attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
    attackSkillLabel: "Firearms", attackTargetValue: 60
});
autoState.combatPhase = "attack";
autoState.rangedFireMode = "auto";
autoState.participants[1].hasRolled = true;
const prompt = new Prompt(autoState);
await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(prompt);
assert.equal(autoState.volleyCount, 1);
assert.equal(autoState.combatPhase, "attack");
const promptContext = await prompt._prepareContext({});
assert.equal(promptContext.canStopAutoFire, true);
prompt.element = { querySelector: () => ({ value: "second" }) };
game.user.targets = new Set([secondToken]);
await Prompt.DEFAULT_OPTIONS.actions.switchRangedTarget.call(prompt);
assert.equal(autoState.rangedTargetTokenId, "second");
assert.equal(autoState.traversePenaltyDice, 1);
assert.equal(patcher.validateSubmittedRoll(autoState, autoState.participants[0], { modifierDice: -2 }), true);
prompt.session = autoState;
await Prompt.DEFAULT_OPTIONS.actions.stopAutoFire.call(prompt);
assert.equal(autoState.combatPhase, "resolution");
assert.equal(autoState.participants.filter((entry) => entry.key === "damage").length, 1);
prompt.session = autoState;
function verifyDamageDice(config) {
    if (config.rollType === "other") assert.equal(config.diceFormula, "1d6");
    return [];
}
coreApi.diceVisualizer.getDiceVisuals = verifyDamageDice;
assert.equal((await prompt._prepareContext({})).canRollDamage, true);

autoWeapon.system.ammo = 12;
autoState = CoC7SessionFactory.createRanged({
    attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
    attackSkillLabel: "Firearms", attackTargetValue: 60
});
autoState.combatPhase = "attack";
autoState.participants[1].hasRolled = true;
const singlePrompt = new Prompt(autoState);
await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(singlePrompt);
assert.equal(autoState.rangedShotsFired, 1);
assert.equal(autoState.combatPhase, "resolution");
assert.equal(autoWeapon.system.ammo, 11);
console.log("Full-auto volley checks passed.");
