import { UniversalRollOrchestrator } from "../core-bridge.mjs";
import { ActorTargetSelectorApp } from "../core-bridge.mjs";
import { CoC7DataMapper } from "./coc7-data-mapper.mjs";

const ENRICHER_SELECTOR = [
    "a.coc7-link",
    "a.coc7-inline-check",
    ".coc7-enricher",
    "a[data-coc7-type]",
    "a[data-type='check']",
    "a[data-type='sanloss']",
    "a[data-characteristic]",
    "a[data-attribute]"
].join(", ");

const CHARACTERISTIC_ALIASES = Object.freeze({
    str: "str", strength: "str", stärke: "str", st: "str",
    con: "con", constitution: "con", konstitution: "con", ko: "con",
    siz: "siz", size: "siz", körpergröße: "siz", gr: "siz",
    dex: "dex", dexterity: "dex", geschicklichkeit: "dex", ge: "dex",
    app: "app", appearance: "app", erscheinung: "app", er: "app",
    int: "int", intelligence: "int", intelligenz: "int", in: "int", idea: "int", idee: "int",
    pow: "pow", power: "pow", manakraft: "pow", ma: "pow",
    edu: "edu", education: "edu", bildung: "edu", bi: "edu", know: "edu", wissen: "edu"
});

/** Routes CoC7 sheet and enriched-text clicks into the shared roll-session workflow. */
export class CoC7Interceptor {
    static register() {
        if (document.body.dataset.roeGlobalCapture) return;
        document.body.dataset.roeGlobalCapture = "true";
        // Capture clicks before the system's handlers can start a competing roll.
        document.body.addEventListener("click", (event) => this.#handleDocumentClick(event), { capture: true });
    }

    static #handleDocumentClick(event) {
        if (event.button !== 0) return;
        this.#onGlobalSheetClick(event);
        this.#onGlobalEnricherClick(event);
    }

    static async #onGlobalSheetClick(event) {
        const sheetEl = event.target.closest("form.coc7.sheet, .application.coc7, [id*='CoC7ModelsActor']");
        if (!sheetEl) return;

        const actor = this.#resolveSheetActor(sheetEl);
        if (!actor) return;

        if (event.target.closest(".item-control, [data-action='edit'], [data-action='delete'], [data-action='tab'], .tabs, input, select")) {
            return;
        }

        const trigger = event.target.closest(
            ".rollable, [data-characteristic], [data-attribute], [data-attrib], [data-skill-id], [data-weapon-id], .weapon-name, .skill-name, .characteristic-label, .attribute-label"
        );
        if (!trigger) return;

        // Shift-click lets a GM open the modifier-preparation phase from a sheet.
        const prepareModifiers = Boolean(game.user.isGM && event.shiftKey);
        const item = this.#resolveClickedItem(actor, trigger);

        if (item?.type === "weapon") {
            this.#haltEvent(event);
            return this.#dispatchWeaponAttack(actor, item, prepareModifiers);
        }

        if (item?.type === "skill" || trigger.classList.contains("skill-name")) {
            this.#haltEvent(event);
            return this.#dispatchSheetSkill(actor, item, trigger, prepareModifiers);
        }

        const charEl = trigger.closest("[data-characteristic], [data-key]");
        const charKey = (charEl?.dataset.characteristic ?? charEl?.dataset.key)?.toLowerCase();
        if (charKey && actor.system?.characteristics?.[charKey]) {
            this.#haltEvent(event);
            return this.#dispatchCharacteristic(actor, charKey, "regular", prepareModifiers);
        }

        const attrEl = trigger.closest("[data-attribute], [data-attrib], [data-key]");
        const attrKey = (attrEl?.dataset.attribute ?? attrEl?.dataset.attrib ?? attrEl?.dataset.key)?.toLowerCase();
        if (attrKey === "san") {
            this.#haltEvent(event);
            return UniversalRollOrchestrator.startSystemRoll("sanity", {
                actor,
                label: game.i18n.localize("ROE_COC7.Resources.Sanity"),
                prepareModifiers
            });
        }
        if (attrKey === "lck" || attrKey === "luck") {
            this.#haltEvent(event);
            return this.#dispatchLuckCheck(actor, prepareModifiers);
        }
    }

    static async #onGlobalEnricherClick(event) {
        const link = event.target.closest(ENRICHER_SELECTOR);
        if (!link || link.closest(".roe-overlay")) return;

        this.#haltEvent(event);

        const parsed = this.#parseEnricherLink(link);
        const prepareModifiers = Boolean(game.user.isGM && event.shiftKey);
        const promptTitle = parsed.rawName || game.i18n.localize("ROE_COC7.RollSession.Types.basic");
        // Prefer selected tokens; otherwise use the player's character or ask the GM.
        const actors = await this.#resolveTargetActors(promptTitle);

        for (const actor of actors) {
            await this.#dispatchEnricherForActor(actor, parsed, prepareModifiers);
        }
    }

    static #parseEnricherLink(link) {
        const dataset = link.dataset;
        const rawType = (dataset.type ?? dataset.coc7Type ?? "").toLowerCase();
        const rawName = (
            dataset.name ??
            dataset.skill ??
            dataset.characteristic ??
            dataset.attribute ??
            link.textContent ??
            ""
        ).replace(/\s*\(.*?\)\s*$/, "").trim();

        const isSanity =
            rawType === "sanloss" ||
            rawType === "sanity" ||
            dataset.sanMax !== undefined ||
            dataset.sanMin !== undefined ||
            /^(san|sanity|stabilität)$/i.test(rawName);

        return { dataset, rawName, isSanity };
    }

    static async #resolveTargetActors(promptTitle) {
        const controlledActors = (canvas?.tokens?.controlled ?? [])
            .map((token) => token.actor)
            .filter(Boolean);
        if (controlledActors.length > 0) {
            return Array.from(new Map(controlledActors.map((a) => [a.id, a])).values());
        }

        if (!game.user.isGM) {
            if (game.user.character) return [game.user.character];
            ui.notifications.warn(game.i18n.localize("ROE.Warnings.NoActiveCharacter"));
            return [];
        }

        return ActorTargetSelectorApp.prompt({ title: promptTitle });
    }

    static async #dispatchEnricherForActor(actor, { dataset, rawName, isSanity }, prepareModifiers) {
        if (isSanity) {
            return UniversalRollOrchestrator.startSystemRoll("sanity", {
                actor,
                label: dataset.reason || rawName || game.i18n.localize("ROE_COC7.Resources.Sanity"),
                lossSuccess: dataset.sanMin ?? dataset.success ?? "0",
                lossFailure: dataset.sanMax ?? dataset.failure ?? "1d6",
                prepareModifiers
            });
        }

        const difficulty = this.#normalizeDifficulty(dataset.difficulty);

        if (/^(lck|luck|glück)$/i.test(rawName)) {
            return this.#dispatchLuckCheck(actor, prepareModifiers);
        }

        const charKey = CHARACTERISTIC_ALIASES[rawName.toLowerCase()];
        if (charKey && actor.system?.characteristics?.[charKey]) {
            return this.#dispatchCharacteristic(actor, charKey, difficulty, prepareModifiers);
        }

        const skillItem = CoC7DataMapper.findActorSkill(actor, { name: rawName });
        if (skillItem) {
            return UniversalRollOrchestrator.startSystemRoll("skill", {
                actor,
                item: skillItem,
                label: CoC7DataMapper.getSkillLabel(skillItem),
                targetValue: CoC7DataMapper.getSkillValue(skillItem),
                difficulty,
                canPush: skillItem.system?.properties?.push !== false,
                prepareModifiers
            });
        }

        const explicitTarget = Number(dataset.target ?? dataset.value);
        if (Number.isFinite(explicitTarget) && explicitTarget > 0) {
            return UniversalRollOrchestrator.startSystemRoll("skill", {
                actor,
                label: rawName || game.i18n.localize("ROE_COC7.RollSession.Types.basic"),
                targetValue: explicitTarget,
                difficulty,
                canPush: true,
                prepareModifiers
            });
        }
    }

    static #dispatchWeaponAttack(actor, weapon, prepareModifiers) {
        const attackData = CoC7DataMapper.resolveWeaponAttack(actor, weapon);
        if (attackData.isRanged && !attackData.target) {
            ui.notifications.warn(game.i18n.localize("ROE_COC7.Warnings.RangedNeedsTarget"));
            return;
        }
        return attackData.isRanged
            ? UniversalRollOrchestrator.startSystemRoll("ranged", { ...attackData, prepareModifiers })
            : UniversalRollOrchestrator.startSystemRoll("combat", { ...attackData, prepareModifiers });
    }

    static #dispatchSheetSkill(actor, item, trigger, prepareModifiers) {
        const label = item ? CoC7DataMapper.getSkillLabel(item) : (trigger.dataset.nameTooltip || trigger.textContent.trim());
        const targetValue = item ? CoC7DataMapper.getSkillValue(item) : Number(trigger.dataset.valueTooltip ?? 0);
        return UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            item: item ?? null,
            label,
            targetValue,
            canPush: item ? item.system?.properties?.push !== false : true,
            prepareModifiers
        });
    }

    static #dispatchCharacteristic(actor, charKey, difficulty, prepareModifiers) {
        return UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            label: game.i18n.localize(`ROE_COC7.Characteristics.${charKey.toUpperCase()}.Label`),
            targetValue: Number(actor.system.characteristics[charKey].value ?? 50),
            difficulty,
            canPush: true,
            prepareModifiers
        });
    }

    static #dispatchLuckCheck(actor, prepareModifiers) {
        return UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            label: game.i18n.localize("ROE_COC7.Resources.Luck"),
            targetValue: Number(actor.system?.attribs?.lck?.value ?? 50),
            difficulty: "regular",
            canChangeDifficulty: false,
            canPush: false,
            prepareModifiers
        });
    }

    static #resolveSheetActor(sheetEl) {
        const idMatch = sheetEl.id?.match(/-(Actor-[A-Za-z0-9]+|Scene-[A-Za-z0-9]+-Token-[A-Za-z0-9]+-Actor-[A-Za-z0-9]+)$/);
        if (idMatch?.[1]) {
            const doc = fromUuidSync(idMatch[1].replace(/-/g, "."));
            if (doc) return doc.actor ?? doc;
        }

        if (foundry.applications?.instances) {
            for (const app of foundry.applications.instances.values()) {
                if (app.element === sheetEl || app.element?.contains(sheetEl)) {
                    return app.document ?? app.actor ?? null;
                }
            }
        }
        return null;
    }

    static #resolveClickedItem(actor, trigger) {
        const itemEl = trigger.closest("[data-item-id], [data-skill-id], [data-weapon-id], [data-uuid]");
        const itemId = itemEl?.dataset.itemId ?? itemEl?.dataset.skillId ?? itemEl?.dataset.weaponId;
        if (itemId) {
            const byId = actor.items.get(itemId);
            if (byId) return byId;
        }
        if (itemEl?.dataset.uuid) {
            const doc = fromUuidSync(itemEl.dataset.uuid);
            if (doc?.parent === actor) return doc;
        }

        const tooltipName = (trigger.dataset.nameTooltip || trigger.textContent || "").trim().toLowerCase();
        if (!tooltipName) return null;
        if (trigger.classList.contains("skill-name")) {
            return actor.items.find((i) => i.type === "skill" && i.name.toLowerCase() === tooltipName) ?? null;
        }
        if (trigger.classList.contains("weapon-name")) {
            return actor.items.find((i) => i.type === "weapon" && i.name.toLowerCase() === tooltipName) ?? null;
        }
        return actor.items.find((i) => (i.type === "skill" || i.type === "weapon") && i.name.toLowerCase() === tooltipName) ?? null;
    }
    static #normalizeDifficulty(raw) {
        const val = String(raw ?? "").toLowerCase();
        if (val === "hard" || val === "1/2" || val === "schwierig") return "hard";
        if (val === "extreme" || val === "1/5" || val === "extrem") return "extreme";
        return "regular";
    }
    static #haltEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
}