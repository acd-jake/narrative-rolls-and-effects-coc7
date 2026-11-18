import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7DataMapper } from "../module/coc7/coc7-data-mapper.mjs";
import { CoC7SessionFactory } from "../module/coc7/coc7-session-factory.mjs";
import { CoC7SessionPatcher } from "../module/coc7/adapter/coc7-session-patcher.mjs";
import { RangedRollStrategy } from "../module/coc7/strategies/ranged-roll-strategy.mjs";

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

setCoreApi({
    session: {
        buildParticipant: (key, actor, label, targetValue, itemId = "") => ({
            key, actorId: actor?.id ?? "", actorName: actor?.name ?? "", actorImg: "",
            label, targetValue, itemId, hasRolled: false, total: null, successLevel: "", isSuccess: false
        }),
        resolveActor: (participant) => actors.get(participant?.actorId) ?? null
    }
});

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

const profile = CoC7DataMapper.getWeaponCombatProfile(revolver, 60);
assert.equal(profile.tracksAmmo, true);
assert.equal(profile.ammo, 6);
assert.equal(profile.maxUses, 3);
assert.deepEqual(profile.fireModes, ["single", "multiple"]);

await CoC7DataMapper.consumeWeaponAmmo(revolver, 2);
assert.equal(revolver.system.ammo, 4);

await CoC7DataMapper.reloadWeapon(revolver);
assert.equal(revolver.system.ammo, 6);

await CoC7DataMapper.setWeaponMalfunction(revolver, true);
assert.equal(CoC7DataMapper.getWeaponCombatProfile(revolver, 60).isJammed, true);
await CoC7DataMapper.setWeaponMalfunction(revolver, false);
assert.equal(CoC7DataMapper.getWeaponCombatProfile(revolver, 60).isJammed, false);
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
assert.equal(CoC7SessionPatcher.computeRangedModifierDice(session, attPart, { fireMode: "multiple", shotIndex: 0 }), 0);
assert.equal(CoC7SessionPatcher.computeRangedModifierDice(session, attPart, { fireMode: "multiple", shotIndex: 1 }), -1);

// Full auto volley overflow into difficulty escalation
const rawVolley3 = CoC7SessionPatcher.computeRangedModifierDice(session, attPart, { fireMode: "auto", volleyIndex: 3 });
assert.equal(rawVolley3, -3);
assert.equal(CoC7SessionPatcher.computeRangedRequiredDifficulty(session, rawVolley3), "extreme");

// 3. Per-bullet armor mitigation & major wound on multi-hit damage
const strategy = new RangedRollStrategy();
const damageState = {
    ...session,
    hitWinnerKey: "attacker",
    rangedHitResults: [
        { targetActorId: "d1", rawDamage: 4, impale: false }, // 4 - 2 armor = 2
        { targetActorId: "d1", rawDamage: 7, impale: true }   // 7 - 2 armor = 5 (>= ceil(10/2) -> Major Wound)
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
const detected = CoC7DataMapper.detectRangedContext(attackerActor, defenderActor, revolver);
assert.equal(detected.distance, 2);
assert.equal(detected.tacticalFlags.pointBlank, true);
assert.equal(detected.tacticalFlags.inMelee, true);

console.log("Ranged combat rules checks passed.");
