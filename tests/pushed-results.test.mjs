import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7DicePresenter } from "../module/coc7/adapter/coc7-dice-presenter.mjs";
import { CoC7PromptPresenter } from "../module/coc7/adapter/coc7-prompt-presenter.mjs";
import { CoC7CheckResolver } from "../module/coc7/coc7-check-resolver.mjs";
import { CombinedRollStrategy } from "../module/coc7/strategies/combined-roll-strategy.mjs";
import { OpposedRollStrategy } from "../module/coc7/strategies/opposed-roll-strategy.mjs";
import { createBasicRollPromptApp } from "../module/coc7/prompts/basic-roll-prompt-app.mjs";
import { createCombinedRollPromptApp } from "../module/coc7/prompts/combined-roll-prompt-app.mjs";
import { createOpposedRollPromptApp } from "../module/coc7/prompts/opposed-roll-prompt-app.mjs";

if (!Array.prototype.at) {
    Array.prototype.at = function (index) {
        return this[index < 0 ? this.length + index : index];
    };
}

let displayMode = "both";
let pushedTag = "Pushed";
globalThis.game = {
    user: { isGM: true },
    settings: { get: (_module, key) => key === "resultDisplayMode" ? displayMode : undefined },
    i18n: {
        localize: (key) => key === "ROE_COC7.Chat.PushedTag" ? pushedTag : key,
        format: (key) => key
    }
};
setCoreApi({
    visibility: { canViewParticipantRoll: (participant) => participant.visible !== false },
    session: { resolveActor: () => ({ isOwner: true, testUserPermission: () => true }) },
    diceVisualizer: { getDiceVisuals: () => [] }
});

const pushed = {
    key: "p0", actorName: "Investigator", label: "Check", hasRolled: true, isPushed: true,
    total: 25, targetValue: 50, successLevel: "regular", isSuccess: true
};
const normal = { ...pushed, key: "p1", isPushed: false };
const hidden = { ...pushed, visible: false };
const dicePresenter = new CoC7DicePresenter();
const promptPresenter = new CoC7PromptPresenter(dicePresenter);
const permissions = { showDetails: true, canViewRoll: true, isGM: true };
const basic = { rollType: "basic", isResolved: true, participants: [pushed] };

for (const mode of ["both", "level", "numbers"]) {
    displayMode = mode;
    assert.ok(dicePresenter.formatParticipantBadge(pushed, basic, permissions).text.includes("(Pushed)"));
    assert.ok(!dicePresenter.formatParticipantBadge(pushed, basic, permissions).className.includes("is-pushed-failure"));
    assert.ok(!dicePresenter.formatParticipantBadge(normal, basic, permissions).text.includes("(Pushed)"));
    assert.ok(!dicePresenter.formatParticipantBadge(hidden, basic, { ...permissions, canViewRoll: false }).text.includes("(Pushed)"));
    assert.ok(!dicePresenter.formatParticipantBadge(pushed, basic, { ...permissions, showDetails: false }).text.includes("(Pushed)"));
}
assert.ok(!dicePresenter.formatParticipantBadge({ ...pushed, hasRolled: false }, basic, permissions).text.includes("(Pushed)"));
pushedTag = "Forciert";
assert.ok(dicePresenter.formatParticipantBadge(pushed, basic, permissions).text.includes("(Forciert)"));
pushedTag = "Pushed";

assert.equal(promptPresenter.preparePromptContext(null, basic, {}).resolvedIsPushed, true);
assert.equal(promptPresenter.preparePromptContext(null, { ...basic, participants: [normal] }, {}).resolvedIsPushed, false);
assert.ok(!promptPresenter.preparePromptContext(null, { ...basic, participants: [hidden] }, {}).resolvedIsPushed);
for (const rollType of ["combined", "opposed"]) {
    const session = { rollType, isResolved: true, participants: [pushed, normal, hidden] };
    const context = promptPresenter.preparePromptContext(null, session, {});
    const checks = rollType === "combined" ? context.resolvedCombinedChecks : context.resolvedOpposedContestants;
    assert.ok(checks[0].result.includes("(Pushed)"));
    assert.ok(!checks[1].result.includes("(Pushed)"));
    assert.ok(!checks[2].result.includes("(Pushed)"));
}

class MockCorePrompt {
    constructor(session) { this.session = session; }
    async _prepareContext() { return { allRolled: true, rollDice: [] }; }
    _evaluateParticipantOptions() { return {}; }
    _isDelegatedToActivePlayer() { return false; }
    _formatModifierLabel() { return ""; }
    _formatDiceFormulaLabel() { return ""; }
}
const core = { createPromptClass: () => MockCorePrompt };
const BasicPrompt = createBasicRollPromptApp(core);
const CombinedPrompt = createCombinedRollPromptApp(core);
const OpposedPrompt = createOpposedRollPromptApp(core);
assert.equal((await new BasicPrompt({ ...basic, isResolved: false })._prepareContext()).showPushedTag, true);
assert.equal((await new BasicPrompt({ ...basic, isResolved: false, participants: [hidden] })._prepareContext()).showPushedTag, false);
assert.equal((await new BasicPrompt({ ...basic, isResolved: false, participants: [normal] })._prepareContext()).showPushedTag, false);
const combined = await new CombinedPrompt({ rollType: "combined", participants: [pushed, hidden] })._prepareContext();
assert.equal(combined.first.showPushedTag, true);
assert.equal(combined.second.showPushedTag, false);
const opposed = await new OpposedPrompt({ rollType: "opposed", participants: [pushed, normal, hidden] })._prepareContext();
assert.ok(opposed.participants[0].statusText.includes("(Pushed)"));
assert.ok(!opposed.participants[1].statusText.includes("(Pushed)"));
assert.ok(!opposed.participants[2].statusText.includes("(Pushed)"));
game.user.isGM = false;
const awaitingOpponent = await new OpposedPrompt({
    rollType: "opposed",
    participants: [pushed, { ...normal, hasRolled: false }]
})._prepareContext();
assert.ok(awaitingOpponent.participants[0].statusText.includes("(Pushed)"));

const failed = { ...pushed, successLevel: "regular", isSuccess: false };
const failedBasic = { ...basic, participants: [failed] };
for (const mode of ["both", "level", "numbers"]) {
    displayMode = mode;
    const badge = dicePresenter.formatParticipantBadge(failed, failedBasic, permissions);
    assert.ok(badge.text.includes("ROE_COC7.Roll.PushFailureResult"));
    assert.ok(badge.className.includes("is-pushed-failure"));
    assert.ok(!dicePresenter.formatParticipantBadge(failed, failedBasic, { ...permissions, canViewRoll: false }).className.includes("is-pushed-failure"));
}
assert.equal(promptPresenter.preparePromptContext(null, failedBasic, {}).resolvedIsPushFailure, true);
assert.equal((await new BasicPrompt({ ...failedBasic, isResolved: false })._prepareContext()).isPushFailure, true);
const hiddenFailed = { ...failed, visible: false };
assert.ok(!promptPresenter.preparePromptContext(null, { ...failedBasic, participants: [hiddenFailed] }, {}).resolvedIsPushFailure);
assert.equal((await new BasicPrompt({ ...failedBasic, isResolved: false, participants: [hiddenFailed] })._prepareContext()).isPushFailure, false);

const original = { ...pushed, isPushed: false, total: 90, successLevel: "failure", isSuccess: false };
const second = { ...original, key: "p1", targetValue: 80 };
const rollData = { total: 60, modifierDice: 0, rollBreakdown: {} };
for (const mode of ["or", "and"]) {
    const session = { rollType: "combined", combinedMode: mode, participants: [original, second] };
    const participants = CoC7CheckResolver.buildPushedParticipants(session, original.key, rollData);
    const next = { ...session, participants };
    const failedCombined = mode === "and";
    assert.deepEqual(participants.map((entry) => entry.pushFailed), [failedCombined, failedCombined]);
    await new CombinedRollStrategy().onRollApplied(participants[0], next);
    assert.equal(Boolean(next.pushFailurePending), failedCombined);
    const resolved = promptPresenter.preparePromptContext(null, { ...next, isResolved: true }, {});
    assert.deepEqual(resolved.resolvedCombinedChecks.map((entry) => entry.isPushFailure), [failedCombined, failedCombined]);
    const hiddenSession = { ...next, participants: [participants[0], { ...participants[1], visible: false }] };
    assert.ok(!dicePresenter.formatParticipantBadge(participants[0], hiddenSession, permissions).className.includes("is-pushed-failure"));
    assert.equal((await new CombinedPrompt(hiddenSession)._prepareContext()).first.isPushFailure, false);
    const legacy = { ...next, participants: participants.map(({ pushFailed, ...entry }) => entry) };
    assert.equal(CoC7CheckResolver.didPushFail(legacy, original.key), failedCombined);
}

const opponent = { ...second, total: 20, successLevel: "hard", isSuccess: true };
const opposedSession = { rollType: "opposed", participants: [original, opponent] };
for (const [total, expectedFailure] of [[40, true], [5, false]]) {
    const participants = CoC7CheckResolver.buildPushedParticipants(opposedSession, original.key, { ...rollData, total });
    const next = { ...opposedSession, participants };
    await new OpposedRollStrategy().onRollApplied(participants[0], next);
    assert.equal(participants[0].pushFailed, expectedFailure);
    assert.equal(Boolean(next.pushFailurePending), expectedFailure);
    assert.equal((await new OpposedPrompt(next)._prepareContext()).participants[0].isPushFailure, expectedFailure);
    assert.equal(promptPresenter.preparePromptContext(null, { ...next, isResolved: true }, {}).resolvedOpposedContestants[0].isPushFailure, expectedFailure);
    const hiddenOpponent = { ...next, participants: [participants[0], { ...opponent, visible: false }] };
    assert.equal((await new OpposedPrompt(hiddenOpponent)._prepareContext()).participants[0].isPushFailure, false);
    assert.ok(!dicePresenter.formatParticipantBadge(participants[0], hiddenOpponent, permissions).className.includes("is-pushed-failure"));
    const legacyParticipant = { ...participants[0] };
    delete legacyParticipant.pushFailed;
    assert.equal(CoC7CheckResolver.didPushFail({ ...next, participants: [legacyParticipant, opponent] }, original.key), expectedFailure);
    const changedOpponent = { ...next, participants: [participants[0], { ...opponent, successLevel: "fumble" }] };
    assert.equal(CoC7CheckResolver.didPushFail(changedOpponent, original.key), expectedFailure);
}
console.log("Pushed result display checks passed.");
