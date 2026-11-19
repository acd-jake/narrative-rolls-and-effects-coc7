import { DamageRollSubmitter } from "../module/coc7/prompts/damage-roll-submitter.mjs";

// Verify CoC7 impale damage: base weapon damage + damage bonus maximized, extra weapon die rolled
const impaleWeapon = {
    id: "wp-knife",
    name: "Hunting Knife",
    type: "weapon",
    system: {
        properties: { impl: true },
        range: { normal: { damage: "1d6" } }
    }
};
const bluntWeapon = {
    id: "wp-club",
    name: "Club",
    type: "weapon",
    system: {
        properties: { impl: false },
        range: { normal: { damage: "1d6" } }
    }
};
const impaleAttacker = {
    id: "att-imp",
    name: "Investigator",
    items: new Map([
        ["wp-knife", impaleWeapon],
        ["wp-club", bluntWeapon]
    ]),
    system: { attribs: { db: { value: "1d4" } } }
};
actors.set("att-imp", impaleAttacker);

globalThis.foundry = { dice: { terms: { Die: class {} } } };
globalThis.Roll = class {
    constructor(formula) {
        this.formula = formula;
        this.terms = [];
        this.total = 0;
    }
    async evaluate({ maximize = false } = {}) {
        if (this.formula === "1d6") this.total = maximize ? 6 : 3;
        else if (this.formula === "1d4") this.total = maximize ? 4 : 2;
        else if (this.formula === "1d6+1d4") this.total = maximize ? 10 : 5;
        return this;
    }
};

let submittedDamage = null;
coreApi.visibility.getCurrentRollMode = () => "publicroll";
coreApi.orchestrator.submitParticipantRoll = async (_id, _key, data) => {
    submittedDamage = data;
};

// 1. Impaling weapon on Extreme success: 1d6 (max 6) + 1d6 (rolled 3) + 1d4 DB (max 4) = 13
const impaleSession = {
    rollType: "combat",
    combatType: "melee",
    hitWinnerKey: "attacker",
    damageBonus: "1d4",
    participants: [
        { key: "attacker", actorId: "att-imp", itemId: "wp-knife", successLevel: "extreme", hasRolled: true },
        { key: "damage", actorId: "att-imp", diceFormula: "1d6+1d6+1d4", hasRolled: false }
    ]
};
game.messages.set("msg-impale", { session: impaleSession });
coreApi.session.getSession = (msg) => msg?.session ?? null;

await DamageRollSubmitter.submit("msg-impale", "damage");
assert.equal(submittedDamage.total, 13);

// 2. Non-impaling weapon on Extreme success: 1d6 (max 6) + 1d4 DB (max 4) = 10
const bluntSession = {
    rollType: "combat",
    combatType: "melee",
    hitWinnerKey: "attacker",
    damageBonus: "1d4",
    participants: [
        { key: "attacker", actorId: "att-imp", itemId: "wp-club", successLevel: "extreme", hasRolled: true },
        { key: "damage", actorId: "att-imp", diceFormula: "1d6+1d4", hasRolled: false }
    ]
};
game.messages.set("msg-blunt", { session: bluntSession });

await DamageRollSubmitter.submit("msg-blunt", "damage");
assert.equal(submittedDamage.total, 10);
