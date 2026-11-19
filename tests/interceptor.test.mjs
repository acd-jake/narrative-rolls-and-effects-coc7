import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7Interceptor } from "../module/coc7/coc7-interceptor.mjs";
import { COC7_MODULE_ID } from "../module/coc7/coc7-settings.mjs";

const startedRolls = [];
const fallbackCalls = [];
let interceptEnabled = true;

globalThis.document = {
    body: {
        dataset: {},
        addEventListener: () => {}
    }
};

globalThis.game = {
    user: { isGM: true, targets: { first: () => null } },
    modules: new Map(),
    settings: {
        settings: new Map([[`${COC7_MODULE_ID}.interceptSystemRolls`, {}]]),
        get: (_mod, key) => (key === "interceptSystemRolls" ? interceptEnabled : false)
    },
    i18n: {
        localize: (key) => key,
        format: (key) => key
    }
};

setCoreApi({
    orchestrator: {
        startSystemRoll: async (type, payload) => {
            startedRolls.push({ type, payload });
            return { type, payload };
        }
    }
});

// Mock CoC7 base sheet & character sheet inheritance hierarchy
class CoC7ModelsActorGlobalSheet {
    constructor(actor) {
        this.actor = actor;
    }
    async _onRollSkillTest(event) {
        fallbackCalls.push(["skill", event]);
    }
    async _onRollCharacteristicTest(event) {
        fallbackCalls.push(["characteristic", event]);
    }
    async _onRollAttribTest(event) {
        fallbackCalls.push(["attribute", event]);
    }
    async _onWeaponRoll(event) {
        fallbackCalls.push(["weaponSheet", event]);
    }
}

class CoC7ModelsActorCharacterSheetV3 extends CoC7ModelsActorGlobalSheet {}

class MockActor {
    async weaponRoll(weapon) {
        fallbackCalls.push(["actorWeaponRoll", weapon]);
    }
}

globalThis.CONFIG = {
    Actor: {
        documentClass: MockActor,
        sheetClasses: {
            character: {
                v3: { cls: CoC7ModelsActorCharacterSheetV3 }
            }
        }
    }
};
CoC7Interceptor.register();

const skillItem = {
    id: "sk1",
    name: "Archäologie",
    type: "skill",
    system: { value: 45, properties: { push: true } }
};
const meleeWeapon = {
    id: "wp1",
    name: "Messer",
    type: "weapon",
    system: { properties: { rngd: false }, skill: { main: { id: "sk1", name: "Archäologie" } } }
};

const actor = new MockActor();
actor.id = "a1";
actor.name = "Jessie Williams";
actor.items = [skillItem, meleeWeapon];
actor.items.get = (id) => actor.items.find((i) => i.id === id) ?? null;
actor.system = {
    characteristics: { dex: { value: 65 } },
    attribs: { lck: { value: 55 }, san: { value: 60 } }
};

const sheet = new CoC7ModelsActorCharacterSheetV3(actor);

const mockEvent = (dataset, shiftKey = false) => ({
    shiftKey,
    currentTarget: {
        dataset,
        textContent: dataset.nameTooltip ?? "",
        closest: () => ({ dataset })
    }
});

// 1. Intercept skill check with Shift-key modifier preparation
await sheet._onRollSkillTest(mockEvent({ itemId: "sk1", nameTooltip: "Archäologie" }, true));
assert.equal(startedRolls.length, 1);
assert.equal(startedRolls[0].type, "skill");
assert.equal(startedRolls[0].payload.targetValue, 45);
assert.equal(startedRolls[0].payload.prepareModifiers, true);

// 2. Intercept characteristic & Luck/Sanity checks
await sheet._onRollCharacteristicTest(mockEvent({ characteristic: "dex" }));
assert.equal(startedRolls[1].type, "skill");
assert.equal(startedRolls[1].payload.targetValue, 65);

await sheet._onRollAttribTest(mockEvent({ attrib: "lck" }));
assert.equal(startedRolls[2].type, "skill");
assert.equal(startedRolls[2].payload.canPush, false);

await sheet._onRollAttribTest(mockEvent({ attrib: "san" }));
assert.equal(startedRolls[3].type, "sanity");

// 3. Intercept weapon attack from sheet & direct Actor.weaponRoll
await sheet._onWeaponRoll(mockEvent({ itemId: "wp1" }));
assert.equal(startedRolls[4].type, "combat");

await actor.weaponRoll(meleeWeapon);
assert.equal(startedRolls[5].type, "combat");
assert.equal(fallbackCalls.length, 0);

// 4. Fallback to native CoC7 handlers when setting is disabled
interceptEnabled = false;
await sheet._onRollSkillTest(mockEvent({ itemId: "sk1" }));
await actor.weaponRoll(meleeWeapon);
assert.equal(startedRolls.length, 6);
assert.equal(fallbackCalls.length, 2);

console.log("CoC7Interceptor checks passed.");
