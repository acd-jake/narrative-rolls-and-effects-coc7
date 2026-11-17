import assert from "assert";
import { setCoreApi } from "../module/core-bridge.mjs";
import { CoC7PromptPresenter } from "../module/coc7/adapter/coc7-prompt-presenter.mjs";
import { CombatRollStrategy } from "../module/coc7/strategies/combat-roll-strategy.mjs";

globalThis.game = {
    user: { isGM: true },
    settings: { get: () => undefined },
    i18n: { localize: (key) => key, format: (key) => key }
};

const actors = new Map();
setCoreApi({
    visibility: { canViewParticipantRoll: (participant) => participant.visible !== false },
    session: { resolveActor: (participant) => actors.get(participant.key) }
});

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
console.log("Combat damage recipient checks passed.");
