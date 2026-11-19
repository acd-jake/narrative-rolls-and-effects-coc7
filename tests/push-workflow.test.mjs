import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { COC7_MODULE_ID } from "../module/coc7/coc7-settings.mjs";
import { PUSH_CONSEQUENCES_SETTING } from "../module/coc7/coc7-constants.mjs";
import { CoC7CheckResolver } from "../module/coc7/coc7-check-resolver.mjs";
import { CoC7PostRollHandler } from "../module/coc7/adapter/coc7-post-roll-handler.mjs";
import { CoC7PushConsequenceService } from "../module/coc7/adapter/coc7-push-consequence-service.mjs";
import { CoC7PromptPresenter } from "../module/coc7/adapter/coc7-prompt-presenter.mjs";
import { CoC7DicePresenter } from "../module/coc7/adapter/coc7-dice-presenter.mjs";
import { PushConsequenceSelectorApp } from "../module/coc7/prompts/push-consequence-selector-app.mjs";

const actors = new Map();
const patches = [];
const postRollActions = [];
let confirmDialogs = [];
let confirmResult = true;
let showForeshadowingToPlayers = true;
let showNarrationToPlayers = true;
let canViewRoll = true;
let savedConsequences = {};

globalThis.Hooks = {
    on: () => 1,
    off: () => {},
    callAll: () => {}
};

class MockApplication {
    constructor(options = {}) {
        this.options = options;
    }
    async _prepareContext() { return {}; }
    _onRender() {}
    render() {}
    async close() {}
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
                implementation: {
                    enrichHTML: async (html) => `ENRICHED:${html}`
                }
            }
        }
    },
    utils: {
        escapeHTML: (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    },
    dice: {
        terms: { Die: class {} }
    }
};

globalThis.Roll = class {
    constructor(formula) {
        this.formula = formula;
        this.terms = [];
        this.total = 88;
    }
    async evaluate() {
        return this;
    }
};

globalThis.game = {
    user: { id: "user-1", isGM: true },
    i18n: {
        lang: "en",
        localize: (key) => key,
        format: (key) => key
    },
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
    diceVisualizer: {
        getDiceVisuals: () => []
    }
});
const skillItem = {
    id: "sk1",
    name: "Library Use",
    type: "skill",
    flags: { CoC7: { cocidFlag: { id: "i.skill.library-use" } } },
    system: { properties: { push: true } }
};

const investigator = {
    id: "pc1",
    type: "character",
    isOwner: true,
    statuses: new Set(),
    items: new Map([["sk1", skillItem]]),
    system: { attribs: { lck: { value: 60 } } }
};

const npcActor = {
    id: "npc1",
    type: "npc",
    isOwner: true,
    statuses: new Set(),
    items: new Map([["sk1", skillItem]]),
    system: { attribs: { lck: { value: 60 } } }
};

const creatureActor = {
    id: "cr1",
    type: "creature",
    isOwner: true,
    statuses: new Set(),
    items: new Map([["sk1", skillItem]]),
    system: { attribs: { lck: { value: 60 } } }
};

actors.set("pc1", investigator);
actors.set("npc1", npcActor);
actors.set("cr1", creatureActor);

const makeParticipant = (actor) => ({
    key: "p0",
    actorId: actor.id,
    actorName: actor.id,
    itemId: "sk1",
    label: "Library Use",
    hasRolled: true,
    total: 75,
    targetValue: 50,
    successLevel: "failure",
    isSuccess: false,
    isPushed: false,
    pushDecided: false,
    luckDecided: false
});

// 1. Only investigators (character) may spend Luck or push rolls; NPCs and creatures cannot
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

// 2. Insanity state detection and preset filtering
assert.equal(CoC7PushConsequenceService.isActorInsane(investigator), false);
assert.equal(CoC7PushConsequenceService.getSkillConsequences(pcSession.participants[0], false).every((e) => !e.insane), true);
investigator.statuses.add("tempoInsane");
assert.equal(CoC7PushConsequenceService.isActorInsane(investigator), true);
assert.equal(CoC7PushConsequenceService.getSkillConsequences(pcSession.participants[0], true).every((e) => e.insane), true);
investigator.statuses.clear();

// 3. When showPushForeshadowingToPlayers = true, clicking Push requests Keeper selection first
showForeshadowingToPlayers = true;
confirmDialogs = [];
patches.length = 0;
await postHandler.pushRoll({ _messageId: "msg1", session: pcSession }, { dataset: { key: "p0" } });
assert.equal(confirmDialogs.length, 0);
assert.equal(patches.length, 1);
assert.equal(patches[0].patch.pushConsequenceRequest.participantKey, "p0");
assert.equal(patches[0].patch.pushConsequenceRequest.isInsane, false);

// 4. Keeper selects a consequence in PushConsequenceSelectorApp (with description & foreshadowing)
const requestedSession = { ...pcSession, pushConsequenceRequest: patches[0].patch.pushConsequenceRequest };
game.messages.set("msg1", { session: requestedSession });
const selectorApp = new PushConsequenceSelectorApp({ messageId: "msg1" });
const selectorCtx = await selectorApp._prepareContext({});
assert.equal(selectorCtx.hasRequest, true);
assert.equal(selectorCtx.presets.length, 5);
assert.ok(selectorCtx.presets[0].descriptionHtml.startsWith("ENRICHED:"));

patches.length = 0;
await PushConsequenceSelectorApp.DEFAULT_OPTIONS.actions.confirmSelection.call(selectorApp);
assert.equal(patches.length, 1);
assert.equal(patches[0].patch.pushConsequenceReady, true);
assert.equal(patches[0].patch.pushConsequenceRequest, null);
assert.ok(patches[0].patch.pushConsequence.title);
assert.ok(patches[0].patch.pushConsequence.foreshadowing);
// 5. After Keeper confirmation, player sees Push warning WITH foreshadowing when setting is enabled
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
assert.equal(postRollActions.length, 1);
assert.equal(postRollActions[0].actionId, "pushRoll");

// 6. When showPushForeshadowingToPlayers = false, player sees Push warning immediately without waiting
showForeshadowingToPlayers = false;
confirmDialogs = [];
patches.length = 0;
await postHandler.pushRoll({ _messageId: "msg1", session: pcSession }, { dataset: { key: "p0" } });
assert.equal(patches.length, 1);
assert.equal(confirmDialogs.length, 1);
assert.ok(!confirmDialogs[0].content.includes("ROE_COC7.Roll.PushForeshadowingHeader"));

// 7. Foreshadowing is visible to GM before resolution, and removed after resolution
const presenter = new CoC7PromptPresenter(new CoC7DicePresenter());
game.user.isGM = true;
const unresolvedGmCtx = await presenter.preparePromptContext(null, readySession, {});
assert.equal(unresolvedGmCtx.showGmPushForeshadowing, true);
assert.ok(unresolvedGmCtx.pushForeshadowingHtml.includes("ENRICHED:"));

game.user.isGM = false;
const unresolvedPlayerCtx = await presenter.preparePromptContext(null, readySession, {});
assert.equal(unresolvedPlayerCtx.showGmPushForeshadowing, false);

// 8. After resolution of a failed pushed roll:
// - Foreshadowing is removed for everyone
// - GM sees narration + rules description
// - Player sees narration only when showPushNarrationToPlayers is true and roll is visible
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
assert.equal(resolvedPlayerHiddenBySettingCtx.showPushNarration, false);

showNarrationToPlayers = true;
canViewRoll = false;
const resolvedPlayerHiddenByVisibilityCtx = await presenter.preparePromptContext(null, failedPushedSession, {});
assert.equal(resolvedPlayerHiddenByVisibilityCtx.showPushOutcomeDetails, false);

console.log("Pushed-roll consequence workflow checks passed.");
