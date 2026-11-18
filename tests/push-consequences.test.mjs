import assert from "assert";
import { getPushDefaults, PUSH_CONSEQUENCE_DEFAULTS } from "../module/coc7/push-consequence-defaults.mjs";
import { collectPushableSkills, createPushConsequenceEditor, getSkillKey } from "../module/coc7/push-consequence-editor.mjs";

const skill = (name, id, push = true) => ({
    name, type: "skill", system: { properties: { push } },
    flags: { CoC7: { cocidFlag: { id } } }
});
const library = skill("Library Use", "i.skill.library-use");
const engineering = skill("Science (Engineering)", "i.skill.science-engineering");
const custom = skill("Science (Dreams)", "i.skill.science-any");
const packSkills = [library, engineering, skill("Science (Any)", "i.skill.science-any"), skill("Dodge", "i.skill.dodge", false)];
const systemIndexFields = ["system.properties", "flags.CoC7.cocidFlag"];
const skillPack = {
    getIndex: async ({ fields = [] } = {}) => {
        const projection = {};
        for (const field of new Set([...systemIndexFields, ...fields])) {
            const parts = field.split(".");
            const property = parts.pop();
            const target = parts.reduce((object, part) => {
                if (object[part] === undefined) object[part] = {};
                return object[part];
            }, projection);
            target[property] = 1;
        }
        return packSkills;
    }
};
let stored = {};
const warnings = [];
globalThis.game = {
    user: { isGM: true },
    i18n: { lang: "en", has: () => false, localize: key => key },
    packs: new Map([["CoC7.skills", skillPack]]),
    items: [],
    actors: [{ items: [custom] }],
    settings: {
        get: () => stored,
        set: async (_module, _setting, value) => { stored = value; }
    }
};
globalThis.ui = { notifications: { warn: message => warnings.push(message), info: () => { } } };
globalThis.document = {
    createElement: () => {
        let html = "";
        return {
            set innerHTML(value) { html = value; },
            get content() {
                return {
                    textContent: html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " "),
                    querySelector: () => /<(img|video|audio|iframe)\b|<a\b[^>]*data-uuid=/.test(html) ? {} : null
                };
            }
        };
    }
};
class MockApplication {
    async _prepareContext() { return {}; }
    _onRender() { }
    render() { }
    async close() { return "closed"; }
}
let confirmation = true;
globalThis.foundry = {
    applications: {
        api: {
            ApplicationV2: MockApplication,
            HandlebarsApplicationMixin: base => base,
            DialogV2: { confirm: async () => confirmation }
        },
        ux: { TextEditor: { implementation: { enrichHTML: async text => `ENRICHED:${text}` } } }
    },
    utils: {
        deepClone: value => JSON.parse(JSON.stringify(value)),
        escapeHTML: value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    }
};

assert.equal(getSkillKey(custom), "name:science (dreams)");
const skills = await collectPushableSkills();
assert.deepEqual([...skills.keys()].sort(), ["i.skill.library-use", "i.skill.science-engineering", "name:science (dreams)"]);
for (const language of ["en", "de"]) {
    const skillIds = Object.keys(PUSH_CONSEQUENCE_DEFAULTS[language]);
    assert.ok(skillIds.length >= 50, `${language} should contain all default skills and specializations`);
    for (const id of skillIds) {
        const defaults = getPushDefaults(language, id);
        assert.equal(defaults.filter(entry => entry.insane).length, 5, `${language}:${id} insane count`);
        assert.equal(defaults.filter(entry => !entry.insane).length, 5, `${language}:${id} sane count`);
        assert.equal(new Set(defaults.map(entry => entry.title)).size, 10, `${language}:${id} unique titles`);
        assert.ok(defaults.every(entry => entry.title && entry.description && entry.narration && entry.foreshadowing), `${language}:${id} complete fields`);
        defaults[0].title = "modified";
        assert.notEqual(getPushDefaults(language, id)[0].title, "modified");
    }
}

const Editor = createPushConsequenceEditor();
const editor = new Editor();
let rows = [];
let change;
let newSkill = "";
let editorClose;
const preview = { innerHTML: "" };
const richEditor = {
    get value() { return rows[0].description; },
    isConnected: true,
    open: false,
    addEventListener: (_event, callback) => { editorClose = callback; },
    querySelector: () => preview
};
editor.element = {
    querySelectorAll: selector => selector === "prose-mirror" ? [richEditor] : rows.map(entry => ({
        querySelector: selector => {
            const name = selector.match(/name="([^"]+)"/)[1];
            return name === "insane" ? { checked: entry[name] } : { value: entry[name] };
        }
    })),
    querySelector: selector => selector === '[name="skill"]'
        ? { addEventListener: (_event, callback) => { change = callback; } }
        : { value: newSkill }
};
const actions = Editor.DEFAULT_OPTIONS.actions;
let context = await editor._prepareContext({});
rows = context.entries.map(entry => ({ ...entry }));
assert.equal(context.skills.find(entry => entry.selected).key, "i.skill.library-use");
await actions.save.call(editor);
assert.deepEqual(stored, {});
rows[0].title = "Edited";
rows[0].description = "<p><strong>Evidence</strong> @UUID[Item.example]{Clue} [[/r 1d4]]</p>";
editor._onRender({}, {});
await editorClose();
assert.equal(preview.innerHTML, `ENRICHED:${rows[0].description}`);
change({ currentTarget: { value: "i.skill.science-engineering" } });
context = await editor._prepareContext({});
assert.equal(context.entries.length, 0);
rows = [];
actions.add.call(editor);
context = await editor._prepareContext({});
rows = context.entries.map(entry => ({ ...entry }));
await actions.save.call(editor);
assert.equal(warnings.length, 1);
assert.deepEqual(stored, {});
rows[0] = { title: "Specimen", description: "<p><br></p>", narration: "<p>Glass breaks.</p>", foreshadowing: "<p>The jar slips.</p>", insane: true };
await actions.save.call(editor);
assert.equal(warnings.length, 2);
rows[0].description = "<p>Lost <em>sample</em>.</p>";
await actions.save.call(editor);
assert.equal(stored.en["i.skill.library-use"].entries[0].title, "Edited");
assert.equal(stored.en["i.skill.library-use"].entries[0].description, "<p><strong>Evidence</strong> @UUID[Item.example]{Clue} [[/r 1d4]]</p>");
assert.equal(stored.en["i.skill.library-use"].entries[0].richText, true);
assert.equal(stored.en["i.skill.science-engineering"].entries[0].insane, true);
await actions.reset.call(editor);
rows = [];
await actions.save.call(editor);
assert.deepEqual(stored.en["i.skill.science-engineering"].entries, []);
newSkill = "Language (Martian)";
actions.addSkill.call(editor);
rows = [];
await actions.save.call(editor);
assert.equal(stored.en["name:language (martian)"].name, newSkill);
actions.add.call(editor);
context = await editor._prepareContext({});
rows = context.entries.map(entry => ({ ...entry }));
confirmation = false;
assert.equal(await editor.close(), undefined);
confirmation = true;
assert.equal(await editor.close(), "closed");

stored = {
    en: {
        "i.skill.library-use": {
            name: "Library Use", entries: [{
                title: "Old text", description: "A < B & C\nNext", narration: "Old narration",
                foreshadowing: "@UUID[Item.example]{Clue}", insane: false
            }]
        }
    }
};
const legacyEditor = new Editor();
legacyEditor.element = editor.element;
context = await legacyEditor._prepareContext({});
rows = context.entries.map(entry => ({ ...entry }));
assert.equal(rows[0].description, "<p>A &lt; B &amp; C<br>Next</p>");
assert.equal(rows[0].enrichedForeshadowing, "ENRICHED:<p>@UUID[Item.example]{Clue}</p>");
const before = JSON.stringify(stored);
await actions.save.call(legacyEditor);
assert.equal(JSON.stringify(stored), before);
console.log("Push consequence editor checks passed.");
