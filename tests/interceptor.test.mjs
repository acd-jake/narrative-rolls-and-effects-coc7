import assert from "assert";
import { describe, it } from "vitest";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7Interceptor } from "../module/coc7/coc7-interceptor.mjs";
import { COC7_MODULE_ID } from "../module/coc7/coc7-settings.mjs";
import { SkillRollStrategy } from "../module/coc7/strategies/skill-roll-strategy.mjs";

describe("CoC7Interceptor and automatic CON/INT checks", () => {
    it("intercepts sheet clicks, chat check cards, manual sanity loss, and applies conditions", async () => {
        const startedRolls = [];
        const fallbackCalls = [];
        const registeredHooks = new Map();
        let interceptEnabled = true;
        let autoApplyConsequences = false;

        globalThis.Hooks = {
            on: (name, fn) => {
                if (!registeredHooks.has(name)) registeredHooks.set(name, []);
                registeredHooks.get(name).push(fn);
            },
            callAll: () => {}
        };

        globalThis.Roll = class MockRoll {
            constructor(formula) {
                this.formula = formula;
                this.total = 4;
            }
            async evaluate() {
                return this;
            }
        };

        globalThis.document = {
            body: {
                dataset: {},
                addEventListener: () => {}
            }
        };

        const actorsById = new Map();
        const actorsByUuid = new Map();
        globalThis.fromUuidSync = (uuid) => actorsByUuid.get(uuid) ?? null;
        globalThis.fromUuid = async (uuid) => actorsByUuid.get(uuid) ?? null;
        globalThis.canvas = { tokens: { controlled: [] } };

        globalThis.game = {
            user: { id: "user-gm", isGM: true, targets: { first: () => null } },
            actors: actorsById,
            modules: new Map(),
            settings: {
                settings: new Map([[`${COC7_MODULE_ID}.interceptSystemRolls`, {}]]),
                get: (mod, key) => {
                    if (mod === COC7_MODULE_ID && key === "interceptSystemRolls") return interceptEnabled;
                    if (key === "autoApplyRollConsequences") return autoApplyConsequences;
                    return false;
                }
            },
            i18n: {
                localize: (key) => key,
                format: (key, data) => `${key}:${data?.name ?? data?.hours ?? ""}`
            }
        };

        setCoreApi({
            orchestrator: {
                startSystemRoll: async (type, payload) => {
                    startedRolls.push({ type, payload });
                    return { type, payload };
                }
            },
            session: {
                resolveActor: (participant) => actorsById.get(participant?.actorId) ?? null
            }
        });

        class CoC7ModelsActorGlobalSheet {
            constructor(actor) { this.actor = actor; }
            async _onRollSkillTest(event) { fallbackCalls.push(["skill", event]); }
            async _onRollCharacteristicTest(event) { fallbackCalls.push(["characteristic", event]); }
            async _onRollAttribTest(event) { fallbackCalls.push(["attribute", event]); }
            async _onWeaponRoll(event) { fallbackCalls.push(["weaponSheet", event]); }
        }

        class CoC7ModelsActorCharacterSheetV3 extends CoC7ModelsActorGlobalSheet {}

        class MockActor {
            async weaponRoll(weapon) { fallbackCalls.push(["actorWeaponRoll", weapon]); }
        }

        globalThis.CONFIG = {
            Actor: {
                documentClass: MockActor,
                sheetClasses: { character: { v3: { cls: CoC7ModelsActorCharacterSheetV3 } } }
            }
        };
        CoC7Interceptor.register();
        const skillItem = {
            id: "sk1", name: "Archäologie", type: "skill",
            system: { value: 45, properties: { push: true } }
        };
        const meleeWeapon = {
            id: "wp1", name: "Messer", type: "weapon",
            system: { properties: { rngd: false }, skill: { main: { id: "sk1", name: "Archäologie" } } }
        };

        const actor = new MockActor();
        actor.id = "a1";
        actor.uuid = "Actor.a1";
        actor.name = "Jessie Williams";
        actor.items = [skillItem, meleeWeapon];
        actor.items.get = (id) => actor.items.find((i) => i.id === id) ?? null;
        actor.statuses = new Set();
        actor.toggleStatusEffect = async (status, { active }) => {
            if (active) actor.statuses.add(status);
            else actor.statuses.delete(status);
        };
        actor.system = {
            characteristics: { dex: { value: 65 }, con: { value: 80 }, int: { value: 70 } },
            attribs: { lck: { value: 55 }, san: { value: 60, dailyLoss: 0 } }
        };
        actorsById.set(actor.id, actor);
        actorsByUuid.set(actor.uuid, actor);

        const sheet = new CoC7ModelsActorCharacterSheetV3(actor);

        const mockEvent = (dataset, shiftKey = false) => ({
            shiftKey,
            currentTarget: {
                dataset,
                textContent: dataset.nameTooltip ?? "",
                closest: () => ({ dataset })
            }
        });

        await sheet._onRollSkillTest(mockEvent({ itemId: "sk1", nameTooltip: "Archäologie" }, true));
        assert.equal(startedRolls.length, 1);
        assert.equal(startedRolls[0].type, "skill");
        assert.equal(startedRolls[0].payload.targetValue, 45);
        assert.equal(startedRolls[0].payload.prepareModifiers, true);

        await sheet._onRollCharacteristicTest(mockEvent({ characteristic: "dex" }));
        assert.equal(startedRolls[1].type, "skill");
        assert.equal(startedRolls[1].payload.targetValue, 65);

        await sheet._onRollAttribTest(mockEvent({ attrib: "lck" }));
        assert.equal(startedRolls[2].type, "skill");
        assert.equal(startedRolls[2].payload.canPush, false);

        await sheet._onRollAttribTest(mockEvent({ attrib: "san" }));
        assert.equal(startedRolls[3].type, "sanity");

        await sheet._onWeaponRoll(mockEvent({ itemId: "wp1" }));
        assert.equal(startedRolls[4].type, "combat");

        await actor.weaponRoll(meleeWeapon);
        assert.equal(startedRolls[5].type, "combat");
        assert.equal(fallbackCalls.length, 0);

        const preCreateHooks = registeredHooks.get("preCreateChatMessage") ?? [];
        assert.equal(preCreateHooks.length, 1);
        const firePreCreate = (data) => preCreateHooks[0]({}, data);

        assert.equal(firePreCreate({ content: "Hello" }), undefined);

        const conResult = firePreCreate({
            blind: true,
            flags: { CoC7: { load: { as: "CoC7ConCheck", actorUuid: "Actor.a1", stayAlive: false } } }
        });
        assert.equal(conResult, false);
        assert.equal(startedRolls.length, 7);
        assert.equal(startedRolls[6].type, "skill");
        assert.equal(startedRolls[6].payload.targetValue, 80);
        assert.equal(startedRolls[6].payload.canPush, false);
        assert.equal(startedRolls[6].payload.isConCheck, true);
        assert.equal(startedRolls[6].payload.stayAlive, false);
        assert.equal(startedRolls[6].payload.rollMode, "blindroll");

        const dyingResult = firePreCreate({
            flags: { CoC7: { load: { as: "CoC7ConCheck", actorUuid: "Actor.a1", stayAlive: true } } }
        });
        assert.equal(dyingResult, false);
        assert.equal(startedRolls.length, 8);
        assert.equal(startedRolls[7].payload.stayAlive, true);

        const sanCardResult = firePreCreate({
            flags: { CoC7: { load: { as: "CoC7SanCheckCard", actorUuid: "Actor.a1", sanReason: "Deep One", sanMin: "1", sanMax: "1d6" } } }
        });
        assert.equal(sanCardResult, false);
        await Promise.resolve();
        assert.equal(startedRolls.length, 9);
        assert.equal(startedRolls[8].type, "sanity");
        assert.equal(startedRolls[8].payload.label, "Deep One");

        const preUpdateHooks = registeredHooks.get("preUpdateActor") ?? [];
        assert.equal(preUpdateHooks.length, 1);
        const firePreUpdate = (changed, options = {}, userId = "user-gm") =>
            preUpdateHooks[0](actor, changed, options, userId);

        firePreUpdate({ system: { attribs: { san: { value: 57 } } } });
        firePreUpdate({ system: { attribs: { san: { value: 52 } } } }, { nreSanityHandled: true });
        assert.equal(startedRolls.length, 9);

        firePreUpdate({ system: { attribs: { san: { value: 54 } } } });
        assert.equal(startedRolls.length, 10);
        assert.equal(startedRolls[9].type, "skill");
        assert.equal(startedRolls[9].payload.targetValue, 70);
        assert.equal(startedRolls[9].payload.canPush, false);
        assert.equal(startedRolls[9].payload.isBoutIntCheck, true);

        const strategy = new SkillRollStrategy();
        const failedParticipant = { key: "p0", actorId: "a1", actorName: "Jessie Williams", hasRolled: true, isSuccess: false };

        autoApplyConsequences = false;
        const manualConState = {
            rollType: "skill", isConCheck: true, stayAlive: false, participants: [failedParticipant]
        };
        await strategy.onRollApplied(failedParticipant, manualConState);
        assert.equal(manualConState.hasPendingConsequences, true);
        assert.equal(actor.statuses.has("unconscious"), false);
        await strategy.applyConsequences(manualConState);
        assert.equal(manualConState.consequenceApplied, true);
        assert.equal(manualConState.hasPendingConsequences, false);
        assert.equal(actor.statuses.has("unconscious"), true);
        assert.ok(strategy.evaluateResolution(manualConState).outcomeHeadline.includes("ROE_COC7.RollSession.ConCheckUnconscious:Jessie Williams"));

        autoApplyConsequences = true;
        const autoDyingState = {
            rollType: "skill", isConCheck: true, stayAlive: true, participants: [failedParticipant]
        };
        await strategy.onRollApplied(failedParticipant, autoDyingState);
        assert.equal(autoDyingState.consequenceApplied, true);
        assert.equal(actor.statuses.has("dead"), true);
        assert.ok(strategy.evaluateResolution(autoDyingState).outcomeHeadline.includes("ROE_COC7.RollSession.ConCheckDead:Jessie Williams"));

        const passedIntParticipant = { key: "p0", actorId: "a1", actorName: "Jessie Williams", hasRolled: true, isSuccess: true };
        const boutIntState = {
            rollType: "skill", isBoutIntCheck: true, participants: [passedIntParticipant]
        };
        await strategy.onRollApplied(passedIntParticipant, boutIntState);
        assert.equal(boutIntState.consequenceApplied, true);
        assert.equal(boutIntState.tempInsanityHours, 4);
        assert.equal(boutIntState.boutDurationRounds, 4);
        assert.equal(actor.statuses.has("temporaryInsanity"), true);
        assert.ok(strategy.evaluateResolution(boutIntState).outcomeHeadline.includes("ROE_COC7.Sanity.TemporaryInsanitySummary:4"));

        interceptEnabled = false;
        await sheet._onRollSkillTest(mockEvent({ itemId: "sk1" }));
        await actor.weaponRoll(meleeWeapon);
        assert.equal(startedRolls.length, 10);
        assert.equal(fallbackCalls.length, 2);
    });
});
