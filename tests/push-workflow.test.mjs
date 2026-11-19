import assert from "assert";
import { describe, it } from "vitest";
import { setCoreApi } from "../module/core-bridge.mjs";
import { COC7_MODULE_ID } from "../module/coc7/coc7-settings.mjs";
import { PUSH_CONSEQUENCES_SETTING } from "../module/coc7/coc7-constants.mjs";
import { CoC7CheckResolver } from "../module/coc7/coc7-check-resolver.mjs";
import { CoC7PostRollHandler } from "../module/coc7/adapter/coc7-post-roll-handler.mjs";
import { CoC7PushConsequenceService } from "../module/coc7/adapter/coc7-push-consequence-service.mjs";
import { CoC7PromptPresenter } from "../module/coc7/adapter/coc7-prompt-presenter.mjs";
import { CoC7DicePresenter } from "../module/coc7/adapter/coc7-dice-presenter.mjs";
import { createPushConsequenceSelectorApp } from "../module/coc7/prompts/push-consequence-selector-app.mjs";

describe("Pushed-roll consequence workflow", () => {
    it("enforces investigator-only push/Luck and handles Keeper consequence selection and visibility", async () => {
        const actors = new Map();
        const patches = [];
        const postRollActions = [];
        let confirmDialogs = [];
        let confirmResult = true;
        let showForeshadowingToPlayers = true;
        let showNarrationToPlayers = true;
        let canViewRoll = true;
        let savedConsequences = {};

        globalThis.Hooks = { on: () => 1, off: () => { }, callAll: () => { } };

        class MockApplication {
            constructor(options = {}) { this.options = options; }
            async _prepareContext() { return {}; }
            _onRender() { }
            render() { }
            async close() { }
        }

        globalThis.foundry = {
            applications: {
                instances: new Map(),
                api: {
                    ApplicationV2: MockApplication,
                    HandlebarsApplicationMixin: (base) => base,
                    DialogV2: {
                        confirm: async (cfg) => {
                            confirmDialogs.push(cfg);
                            return confirmResult;
                        }
                    }
                },
                ux: {
                    TextEditor: {
                        implementation: { enrichHTML: async (html) => `ENRICHED:${html}` }
                    }
                }
            },
            utils: {
                escapeHTML: (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            },
            dice: { terms: { Die: class { } } }
        };

        globalThis.Roll = class {
            constructor(formula) { this.formula = formula; this.terms = []; this.total = 88; }
            async evaluate() { return this; }
        };

        globalThis.game = {
            user: { id: "user-1", isGM: true },
            i18n: { lang: "en", localize: (key) => key, format: (key) => key },
            settings: {
                settings: new Map(),
                get: (mod, key) => {
                    if (mod !== COC7_MODULE_ID) return undefined;
                    if (key === PUSH_CONSEQUENCES_SETTING) return savedConsequences;
                    if (key === "showPushForeshadowingToPlayers") return showForeshadowingToPlayers;
                    if (key === "showPushNarrationToPlayers") return showNarrationToPlayers;
                    if (key === "resultDisplayMode") return "both";
                    return undefined;
                }
            },
            messages: new Map()
        };

        setCoreApi({
            session: {
                resolveActor: (p) => actors.get(p?.actorId) ?? null,
                getSession: (msg) => msg?.session ?? null
            },
            visibility: {
                getCurrentRollMode: () => "publicroll",
                canViewParticipantRoll: () => canViewRoll
            },
            orchestrator: {
                updateSessionPatch: async (id, patch) => patches.push({ id, patch }),
                executePostRollAction: async (id, key, actionId, payload) => postRollActions.push({ id, key, actionId, payload })
            },
            diceVisualizer: { getDiceVisuals: () => [] }
        });
        const PushConsequenceSelectorApp = createPushConsequenceSelectorApp();

        const skillItem = {
            id: "sk1", name: "Library Use", type: "skill",
            flags: { CoC7: { cocidFlag: { id: "i.skill.library-use" } } },
            system: { properties: { push: true } }
        };

        const investigator = { id: "pc1", type: "character", isOwner: true, statuses: new Set(), items: new Map([["sk1", skillItem]]), system: { attribs: { lck: { value: 60 } } } };
        const npcActor = { id: "npc1", type: "npc", isOwner: true, statuses: new Set(), items: new Map([["sk1", skillItem]]), system: { attribs: { lck: { value: 60 } } } };
        const creatureActor = { id: "cr1", type: "creature", isOwner: true, statuses: new Set(), items: new Map([["sk1", skillItem]]), system: { attribs: { lck: { value: 60 } } } };

        actors.set("pc1", investigator);
        actors.set("npc1", npcActor);
        actors.set("cr1", creatureActor);

        const makeParticipant = (actor) => ({
            key: "p0", actorId: actor.id, actorName: actor.id, itemId: "sk1", label: "Library Use",
            hasRolled: true, total: 75, targetValue: 50, successLevel: "failure", isSuccess: false,
            isPushed: false, pushDecided: false, luckDecided: false
        });

        const postHandler = new CoC7PostRollHandler();
        const pcSession = { rollType: "skill", difficulty: "regular", participants: [makeParticipant(investigator)] };
        const npcSession = { rollType: "skill", difficulty: "regular", participants: [makeParticipant(npcActor)] };
        const creatureSession = { rollType: "skill", difficulty: "regular", participants: [makeParticipant(creatureActor)] };

        assert.equal(CoC7CheckResolver.canPush(pcSession, "p0"), true);
        assert.equal(CoC7CheckResolver.canPush(npcSession, "p0"), false);
        assert.equal(CoC7CheckResolver.canPush(creatureSession, "p0"), false);

        const pcOpts = postHandler.evaluateParticipantOptions(pcSession.participants[0], pcSession, false);
        const npcOpts = postHandler.evaluateParticipantOptions(npcSession.participants[0], npcSession, false);
        const creatureOpts = postHandler.evaluateParticipantOptions(creatureSession.participants[0], creatureSession, false);
        assert.equal(pcOpts.canSpendLuck, true);
        assert.equal(pcOpts.canPush, true);
        assert.equal(npcOpts.canSpendLuck, false);
        assert.equal(npcOpts.canPush, false);
        assert.equal(creatureOpts.canSpendLuck, false);
        assert.equal(creatureOpts.canPush, false);

        assert.equal(CoC7PushConsequenceService.isActorInsane(investigator), false);
        investigator.statuses.add("tempoInsane");
        assert.equal(CoC7PushConsequenceService.isActorInsane(investigator), true);
        investigator.statuses.clear();

        showForeshadowingToPlayers = true;
        confirmDialogs = [];
        patches.length = 0;
        await postHandler.pushRoll({ _messageId: "msg1", session: pcSession }, { dataset: { key: "p0" } });
        assert.equal(confirmDialogs.length, 0);
        assert.equal(patches.length, 1);
        assert.equal(patches[0].patch.pushConsequenceRequest.participantKey, "p0");

        const requestedSession = { ...pcSession, pushConsequenceRequest: patches[0].patch.pushConsequenceRequest };
        game.messages.set("msg1", { session: requestedSession });
        const selectorApp = new PushConsequenceSelectorApp({ messageId: "msg1" });
        const selectorCtx = await selectorApp._prepareContext({});
        assert.equal(selectorCtx.hasRequest, true);
        assert.equal(selectorCtx.presets.length, 5);
        assert.ok(selectorCtx.presets[0].descriptionHtml.startsWith("ENRICHED:"));

        patches.length = 0;
        await PushConsequenceSelectorApp.DEFAULT_OPTIONS.actions.confirmSelection.call(selectorApp);
        assert.equal(patches[0].patch.pushConsequenceReady, true);
        const readySession = {
            ...pcSession,
            pushConsequenceReady: true,
            pushConsequence: patches[0].patch.pushConsequence
        };
        game.user.isGM = false;
        confirmDialogs = [];
        postRollActions.length = 0;
        await postHandler.pushRoll({ _messageId: "msg1", session: readySession }, { dataset: { key: "p0" } });
        assert.equal(confirmDialogs.length, 1);
        assert.ok(confirmDialogs[0].content.includes("ROE_COC7.Roll.PushForeshadowingHeader"));
        assert.equal(postRollActions[0].actionId, "pushRoll");

        showForeshadowingToPlayers = false;
        confirmDialogs = [];
        patches.length = 0;
        await postHandler.pushRoll({ _messageId: "msg1", session: pcSession }, { dataset: { key: "p0" } });
        assert.equal(confirmDialogs.length, 1);
        assert.ok(!confirmDialogs[0].content.includes("ROE_COC7.Roll.PushForeshadowingHeader"));

        const presenter = new CoC7PromptPresenter(new CoC7DicePresenter());
        game.user.isGM = true;
        const unresolvedGmCtx = await presenter.preparePromptContext(null, readySession, {});
        assert.equal(unresolvedGmCtx.showGmPushForeshadowing, true);

        game.user.isGM = false;
        const unresolvedPlayerCtx = await presenter.preparePromptContext(null, readySession, {});
        assert.equal(unresolvedPlayerCtx.showGmPushForeshadowing, false);

        const failedPushedSession = {
            ...readySession,
            isResolved: true,
            participants: [{ ...readySession.participants[0], isPushed: true, isSuccess: false, pushFailed: true }]
        };

        game.user.isGM = true;
        const resolvedGmCtx = await presenter.preparePromptContext(null, failedPushedSession, {});
        assert.equal(resolvedGmCtx.showGmPushForeshadowing, false);
        assert.equal(resolvedGmCtx.showPushOutcomeDetails, true);
        assert.equal(resolvedGmCtx.showPushDescription, true);
        assert.equal(resolvedGmCtx.showPushNarration, true);

        game.user.isGM = false;
        showNarrationToPlayers = true;
        canViewRoll = true;
        const resolvedPlayerVisibleCtx = await presenter.preparePromptContext(null, failedPushedSession, {});
        assert.equal(resolvedPlayerVisibleCtx.showGmPushForeshadowing, false);
        assert.equal(resolvedPlayerVisibleCtx.showPushOutcomeDetails, true);
        assert.equal(resolvedPlayerVisibleCtx.showPushDescription, false);
        assert.equal(resolvedPlayerVisibleCtx.showPushNarration, true);

        showNarrationToPlayers = false;
        const resolvedPlayerHiddenBySettingCtx = await presenter.preparePromptContext(null, failedPushedSession, {});
        assert.equal(resolvedPlayerHiddenBySettingCtx.showPushOutcomeDetails, false);

        showNarrationToPlayers = true;
        canViewRoll = false;
        const resolvedPlayerHiddenByVisibilityCtx = await presenter.preparePromptContext(null, failedPushedSession, {});
        assert.equal(resolvedPlayerHiddenByVisibilityCtx.showPushOutcomeDetails, false);
    });
});
