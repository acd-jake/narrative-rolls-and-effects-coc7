import { COC7_MODULE_ID } from "./coc7-settings.mjs";
import { PUSH_CONSEQUENCES_SETTING } from "./coc7-constants.mjs";
import { getPushDefaults } from "./push-consequence-defaults.mjs";

const TEXT_FIELDS = ["description", "narration", "foreshadowing"];

function editorEntry(entry) {
    const result = { title: entry.title, insane: entry.insane, richText: true };
    for (const field of TEXT_FIELDS) {
        const text = entry[field];
        result[field] = entry.richText || !text
            ? text
            : `<p>${foundry.utils.escapeHTML(text).replace(/\r?\n/g, "<br>")}</p>`;
    }
    return result;
}

async function enrichText(text) {
    return foundry.applications.ux.TextEditor.implementation.enrichHTML(text, { secrets: game.user.isGM });
}

function hasRichTextContent(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return Boolean(template.content.textContent.trim() || template.content.querySelector("img, video, audio, iframe, a[data-uuid]"));
}

export function getSkillKey(skill) {
    const id = skill.flags?.CoC7?.cocidFlag?.id;
    if (id && !id.endsWith("-any")) return id;
    return `name:${skill.name.trim().toLocaleLowerCase()}`;
}

export async function collectPushableSkills() {
    const skills = new Map();
    const add = (skill, fromPack = false) => {
        if (skill.type !== "skill" || skill.system?.properties?.push === false || !skill.name?.trim()) return;
        const id = skill.flags?.CoC7?.cocidFlag?.id;
        if (fromPack && id?.endsWith("-any")) return;
        const key = getSkillKey(skill);
        const localizationKey = `CoC7.CoCIDFlag.keys.${id}`;
        const label = fromPack && id && game.i18n.has(localizationKey) ? game.i18n.localize(localizationKey) : skill.name;
        if (!skills.has(key)) skills.set(key, { key, name: label });
    };

    for (const item of game.items ?? []) add(item);
    for (const actor of game.actors ?? []) {
        for (const item of actor.items ?? []) add(item);
    }
    const pack = game.packs.get("CoC7.skills");
    if (pack) {
        const index = await pack.getIndex({ fields: ["system.properties", "flags.CoC7.cocidFlag"] });
        for (const skill of index) add(skill, true);
    }
    return skills;
}

export function createPushConsequenceEditor() {
    const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
    return class PushConsequenceEditor extends HandlebarsApplicationMixin(ApplicationV2) {
        static DEFAULT_OPTIONS = {
            id: "roe-coc7-push-consequence-editor",
            tag: "div",
            classes: ["roe-coc7-push-editor"],
            position: { width: 800, height: 700 },
            window: { title: "ROE_COC7.PushEditor.Title", resizable: true },
            actions: {
                add: this.#add,
                remove: this.#remove,
                save: this.#save,
                reset: this.#reset,
                addSkill: this.#addSkill
            }
        };

        static PARTS = {
            editor: { template: `modules/${COC7_MODULE_ID}/templates/push-consequence-editor.hbs` }
        };

        #skills;
        #draft = {};
        #dirty = new Set();
        #selected = "";
        #language = game.i18n.lang === "de" ? "de" : "en";

        async _prepareContext(options) {
            const context = await super._prepareContext(options);
            if (!this.#skills) {
                this.#skills = await collectPushableSkills();
                const saved = game.settings.get(COC7_MODULE_ID, PUSH_CONSEQUENCES_SETTING)[this.#language] ?? {};
                for (const [key, value] of Object.entries(saved)) {
                    if (!this.#skills.has(key)) this.#skills.set(key, { key, name: value.name });
                }
                this.#draft = foundry.utils.deepClone(saved);
            }
            const skills = [...this.#skills.values()].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
            if (!this.#selected && skills.length) this.#selected = skills[0].key;
            const current = this.#skills.get(this.#selected);
            const entries = await Promise.all((current ? this.#entries(current) : []).map(async (entry, index) => {
                const editable = editorEntry(entry);
                const [enrichedDescription, enrichedNarration, enrichedForeshadowing] = await Promise.all(
                    TEXT_FIELDS.map(field => enrichText(editable[field]))
                );
                return { ...editable, number: index + 1, enrichedDescription, enrichedNarration, enrichedForeshadowing };
            }));
            return { ...context, skills: skills.map(skill => ({ ...skill, selected: skill.key === this.#selected })), entries, hasSkill: Boolean(current) };
        }

        #entries(skill) {
            return this.#draft[skill.key]?.entries ?? getPushDefaults(this.#language, skill.key);
        }

        #capture() {
            const skill = this.#skills.get(this.#selected);
            if (!skill) return;
            const rows = this.element.querySelectorAll("[data-consequence]");
            const entries = [...rows].map(row => ({
                title: row.querySelector('[name="title"]').value,
                insane: row.querySelector('[name="insane"]').checked,
                richText: true,
                ...Object.fromEntries(TEXT_FIELDS.map(field => [field, row.querySelector(`prose-mirror[name="${field}"]`).value]))
            }));
            const previous = this.#entries(skill).map(editorEntry);
            if (JSON.stringify(entries) !== JSON.stringify(previous)) {
                this.#draft[skill.key] = { name: skill.name, entries };
                this.#dirty.add(skill.key);
            }
        }

        _onRender(context, options) {
            super._onRender(context, options);
            this.element.querySelector('[name="skill"]')?.addEventListener("change", event => {
                this.#capture();
                this.#selected = event.currentTarget.value;
                this.render();
            });
            for (const editor of this.element.querySelectorAll("prose-mirror")) {
                editor.addEventListener("close", async () => {
                    const value = editor.value;
                    try {
                        const enriched = await enrichText(value);
                        if (editor.isConnected && !editor.open && editor.value === value) {
                            editor.querySelector(".editor-content").innerHTML = enriched;
                        }
                    } catch (error) {
                        console.error(`${COC7_MODULE_ID} | Failed to enrich consequence text`, error);
                        ui.notifications.error(game.i18n.localize("ROE_COC7.PushEditor.EnrichmentError"));
                    }
                });
            }
        }

        static #add() {
            this.#capture();
            const skill = this.#skills.get(this.#selected);
            const entries = this.#entries(skill).map(entry => ({ ...entry }));
            entries.push({ title: "", description: "", narration: "", foreshadowing: "", insane: false });
            this.#draft[skill.key] = { name: skill.name, entries };
            this.#dirty.add(skill.key);
            this.render();
        }

        static #remove(event, target) {
            this.#capture();
            const skill = this.#skills.get(this.#selected);
            const entries = this.#entries(skill).map(entry => ({ ...entry }));
            entries.splice(Number(target.dataset.index), 1);
            this.#draft[skill.key] = { name: skill.name, entries };
            this.#dirty.add(skill.key);
            this.render();
        }

        static async #reset() {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize("ROE_COC7.PushEditor.Reset") },
                content: `<p>${game.i18n.localize("ROE_COC7.PushEditor.ConfirmReset")}</p>`,
                rejectClose: false
            });
            if (!confirmed) return;
            const skill = this.#skills.get(this.#selected);
            this.#draft[skill.key] = { name: skill.name, entries: getPushDefaults(this.#language, skill.key) };
            this.#dirty.add(skill.key);
            this.render();
        }

        static #addSkill() {
            this.#capture();
            const input = this.element.querySelector('[name="newSkill"]');
            const name = input.value.trim();
            if (!name) {
                ui.notifications.warn(game.i18n.localize("ROE_COC7.PushEditor.SkillRequired"));
                return;
            }
            const existing = [...this.#skills.values()].find(skill =>
                skill.name.toLocaleLowerCase() === name.toLocaleLowerCase());
            if (existing) {
                this.#selected = existing.key;
                this.render();
                return;
            }
            const key = getSkillKey({ name });
            if (!this.#skills.has(key)) this.#skills.set(key, { key, name });
            this.#selected = key;
            if (!this.#draft[key]) this.#draft[key] = { name, entries: [] };
            this.#dirty.add(key);
            this.render();
        }

        static async #save() {
            this.#capture();
            if (!this.#dirty.size) return;
            for (const key of this.#dirty) {
                if (this.#draft[key].entries.some(entry =>
                    !entry.title.trim() || TEXT_FIELDS.some(field =>
                        !hasRichTextContent(editorEntry(entry)[field])))) {
                    ui.notifications.warn(game.i18n.localize("ROE_COC7.PushEditor.FieldsRequired"));
                    this.#selected = key;
                    this.render();
                    return;
                }
            }
            const saved = foundry.utils.deepClone(game.settings.get(COC7_MODULE_ID, PUSH_CONSEQUENCES_SETTING));
            if (!saved[this.#language]) saved[this.#language] = {};
            for (const key of this.#dirty) saved[this.#language][key] = this.#draft[key];
            await game.settings.set(COC7_MODULE_ID, PUSH_CONSEQUENCES_SETTING, saved);
            this.#dirty.clear();
            ui.notifications.info(game.i18n.localize("ROE_COC7.PushEditor.Saved"));
        }

        async close(options = {}) {
            if (this.#skills && this.element) this.#capture();
            if (this.#dirty.size) {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize("ROE_COC7.PushEditor.Title") },
                    content: `<p>${game.i18n.localize("ROE_COC7.PushEditor.ConfirmClose")}</p>`,
                    rejectClose: false
                });
                if (!confirmed) return;
            }
            return super.close(options);
        }
    };
}