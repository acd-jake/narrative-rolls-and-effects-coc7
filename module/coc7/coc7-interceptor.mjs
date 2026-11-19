import { UniversalRollOrchestrator, ActorTargetSelectorApp } from "../core-bridge.mjs";
import { CoC7DataMapper } from "./coc7-data-mapper.mjs";
import { COC7_MODULE_ID, CoC7Settings } from "./coc7-settings.mjs";

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

/** Monkey-patches CoC7 system roll entry points and routes checks into NRE sessions. */
export class CoC7Interceptor {
    static #patched = false;
    static #chatHookRegistered = false;

    static register() {
        this.#patchSystemMethods();
        if (!document.body.dataset.roeGlobalCapture) {
            document.body.dataset.roeGlobalCapture = "true";
            document.body.addEventListener("click", (event) => this.#onGlobalEnricherClick(event), { capture: true });
        }
        if (!this.#chatHookRegistered) {
            this.#chatHookRegistered = true;
            Hooks.on("preCreateChatMessage", (message, data) => this.#onPreCreateChatMessage(message, data));
            Hooks.on("preUpdateActor", (actor, changed, options, userId) => this.#onPreUpdateActor(actor, changed, options, userId));
        }
    }

    static #patchedPrototypes = new WeakSet();

    static #isHandlingRoll = false;

    static #runGuarded(callback) {
        if (this.#isHandlingRoll) return undefined;
        this.#isHandlingRoll = true;
        try {
            return callback();
        } finally {
            setTimeout(() => { this.#isHandlingRoll = false; }, 0);
        }
    }

    static #patchSystemMethods() {
        if (this.#patched) return;
        const actorProto = CONFIG.Actor?.documentClass?.prototype;
        if (!actorProto) return;
        this.#patched = true;

        const patchedHooks = [];

        // 1. Alle registrierten Actor-Sheets und deren Basisklassen einmalig auf eigenen Methoden patchen
        const allSheetClasses = Object.values(CONFIG.Actor?.sheetClasses ?? {})
            .flatMap((group) => Object.values(group))
            .map((entry) => entry.cls)
            .filter(Boolean);

        const prototypesToPatch = new Set();
        for (const cls of allSheetClasses) {
            for (let current = cls; current && current !== Object; current = Object.getPrototypeOf(current)) {
                if (current.prototype) prototypesToPatch.add(current.prototype);
            }
        }

        for (const proto of prototypesToPatch) {
            if (this.#patchedPrototypes.has(proto)) continue;
            this.#patchedPrototypes.add(proto);
            const className = proto.constructor?.name || "SheetProto";

            if (Object.hasOwn(proto, "_onWeaponRoll") && typeof proto._onWeaponRoll === "function") {
                patchedHooks.push(`${className}._onWeaponRoll`);
                this.#wrapMethod(proto, "_onWeaponRoll", "", async function (wrapped, event, ...args) {
                    if (!CoC7Settings.isSystemInterceptionEnabled()) return wrapped.call(this, event, ...args);
                    const trigger = event?.currentTarget ?? event?.target;
                    const itemEl = trigger?.closest?.("[data-item-id], [data-weapon-id]");
                    const itemId = itemEl?.dataset?.itemId ?? itemEl?.dataset?.weaponId;
                    const weaponName = (trigger?.dataset?.nameTooltip || trigger?.textContent || "").trim().toLowerCase();
                    const weapon = itemId
                        ? this.actor?.items?.get(itemId)
                        : this.actor?.items?.find((i) => i.type === "weapon" && i.name.toLowerCase() === weaponName);
                    if (!weapon) return wrapped.call(this, event, ...args);
                    return CoC7Interceptor.#runGuarded(() =>
                        CoC7Interceptor.#dispatchWeaponAttack(this.actor, weapon, Boolean(game.user.isGM && event?.shiftKey))
                    );
                });
            }

            if (Object.hasOwn(proto, "_onRollSkillTest") && typeof proto._onRollSkillTest === "function") {
                patchedHooks.push(`${className}._onRollSkillTest`);
                this.#wrapMethod(proto, "_onRollSkillTest", "", async function (wrapped, event, ...args) {
                    if (!CoC7Settings.isSystemInterceptionEnabled()) return wrapped.call(this, event, ...args);
                    const trigger = event?.currentTarget ?? event?.target;
                    const itemEl = trigger?.closest?.("[data-item-id], [data-skill-id]");
                    const itemId = itemEl?.dataset?.itemId ?? itemEl?.dataset?.skillId;
                    const skillName = (trigger?.dataset?.nameTooltip || trigger?.textContent || "").trim();
                    const skillItem = itemId ? this.actor?.items?.get(itemId) : CoC7DataMapper.findActorSkill(this.actor, { name: skillName });
                    if (!skillItem && !skillName) return wrapped.call(this, event, ...args);
                    return CoC7Interceptor.#runGuarded(() =>
                        CoC7Interceptor.#handleNormalizedTrigger({
                            type: "SKILL",
                            actor: this.actor,
                            item: skillItem,
                            skillName,
                            isShiftKey: Boolean(event?.shiftKey)
                        })
                    );
                });
            }

            for (const methodName of ["_onRollCharacteristicTest", "_onRollCharacteriticTest"]) {
                if (Object.hasOwn(proto, methodName) && typeof proto[methodName] === "function") {
                    patchedHooks.push(`${className}.${methodName}`);
                    this.#wrapMethod(proto, methodName, "", async function (wrapped, event, ...args) {
                        if (!CoC7Settings.isSystemInterceptionEnabled()) return wrapped.call(this, event, ...args);
                        const trigger = event?.currentTarget ?? event?.target;
                        const charEl = trigger?.closest?.("[data-characteristic], [data-key]");
                        const charKey = charEl?.dataset?.characteristic ?? charEl?.dataset?.key;
                        if (!charKey) return wrapped.call(this, event, ...args);
                        return CoC7Interceptor.#runGuarded(() =>
                            CoC7Interceptor.#handleNormalizedTrigger({
                                type: "CHARACTERISTIC",
                                actor: this.actor,
                                characteristic: charKey,
                                isShiftKey: Boolean(event?.shiftKey)
                            })
                        );
                    });
                }
            }

            if (Object.hasOwn(proto, "_onRollAttribTest") && typeof proto._onRollAttribTest === "function") {
                patchedHooks.push(`${className}._onRollAttribTest`);
                this.#wrapMethod(proto, "_onRollAttribTest", "", async function (wrapped, event, ...args) {
                    if (!CoC7Settings.isSystemInterceptionEnabled()) return wrapped.call(this, event, ...args);
                    const trigger = event?.currentTarget ?? event?.target;
                    const attrEl = trigger?.closest?.("[data-attrib], [data-attribute], [data-key]");
                    const attrKey = attrEl?.dataset?.attrib ?? attrEl?.dataset?.attribute ?? attrEl?.dataset?.key;
                    if (!attrKey || !["lck", "luck", "san"].includes(attrKey.toLowerCase())) {
                        return wrapped.call(this, event, ...args);
                    }
                    return CoC7Interceptor.#runGuarded(() =>
                        CoC7Interceptor.#handleNormalizedTrigger({
                            type: "ATTRIBUTE",
                            actor: this.actor,
                            attribute: attrKey,
                            isShiftKey: Boolean(event?.shiftKey)
                        })
                    );
                });
            }

            if (Object.hasOwn(proto, "_onSanCheck") && typeof proto._onSanCheck === "function") {
                patchedHooks.push(`${className}._onSanCheck`);
                this.#wrapMethod(proto, "_onSanCheck", "", async function (wrapped, event, ...args) {
                    if (!CoC7Settings.isSystemInterceptionEnabled()) return wrapped.call(this, event, ...args);
                    return CoC7Interceptor.#runGuarded(() =>
                        CoC7Interceptor.#handleNormalizedTrigger({
                            type: "SAN_CHECK",
                            actor: this.actor,
                            sanMin: this.actor?.system?.special?.sanLoss?.checkPassed ?? "0",
                            sanMax: this.actor?.system?.special?.sanLoss?.checkFailled ?? "1d6",
                            isShiftKey: Boolean(event?.shiftKey)
                        })
                    );
                });
            }
        }

        // 2. Actor-Methoden für Makros & direkte API-Aufrufe
        if (Object.hasOwn(actorProto, "weaponRoll") && typeof actorProto.weaponRoll === "function") {
            patchedHooks.push("Actor.weaponRoll");
            this.#wrapMethod(actorProto, "weaponRoll", "CONFIG.Actor.documentClass.prototype.weaponRoll", async function (wrapped, weapon, attackerUuid, ...args) {
                if (!CoC7Settings.isSystemInterceptionEnabled() || weapon?.flags?.[COC7_MODULE_ID]?.bypassNre) {
                    return wrapped.call(this, weapon, attackerUuid, ...args);
                }
                const resolved = attackerUuid ? await fromUuid(attackerUuid) : this;
                const actor = resolved?.actor ?? resolved ?? this;
                if (!actor || !weapon) return wrapped.call(this, weapon, attackerUuid, ...args);
                return CoC7Interceptor.#runGuarded(() =>
                    CoC7Interceptor.#dispatchWeaponAttack(actor, weapon, Boolean(game.user.isGM && globalThis.event?.shiftKey))
                );
            });
        }

        console.debug(`${COC7_MODULE_ID} | Patched CoC7 roll entry points:`, patchedHooks);
    }

    static #wrapMethod(target, methodName, libWrapperTarget, handler) {
        if (libWrapperTarget && game.modules?.get("lib-wrapper")?.active && typeof globalThis.libWrapper?.register === "function") {
            globalThis.libWrapper.register(COC7_MODULE_ID, libWrapperTarget, handler, "MIXED");
            return;
        }
        const original = target[methodName];
        target[methodName] = function (...args) {
            return handler.call(this, original, ...args);
        };
    }


    static async #handleNormalizedTrigger(options) {
        const prepareModifiers = Boolean(game.user.isGM && (options.isShiftKey || globalThis.event?.shiftKey));
        const difficulty = this.#normalizeDifficulty(options.difficulty);
        const rollMode = options.isBlind ? "blindroll" : undefined;

        if (options.type === "COMBINED" || Array.isArray(options.checks)) {
            const actor = await this.#resolveActorRef(options.actor ?? options.actorUuid);
            if (!actor || !Array.isArray(options.checks) || options.checks.length < 2) return undefined;
            const checks = options.checks.slice(0, 2).map((chk) => this.#mapNormalizedCheck(actor, chk));
            return UniversalRollOrchestrator.startSystemRoll("combined", {
                actor,
                checks,
                combinedMode: options.combinedMode === "or" ? "or" : "and",
                difficulty,
                rollMode,
                prepareModifiers
            });
        }

        if (options.type === "OPPOSED" || Array.isArray(options.contestants)) {
            if (!Array.isArray(options.contestants) || options.contestants.length < 2) return undefined;
            const contestants = [];
            for (const entry of options.contestants) {
                const cActor = await this.#resolveActorRef(entry.actor ?? entry.actorUuid);
                if (!cActor) return undefined;
                const mapped = this.#mapNormalizedCheck(cActor, entry);
                contestants.push({ actor: cActor, ...mapped });
            }
            return UniversalRollOrchestrator.startSystemRoll("opposed", {
                title: options.title || `${contestants[0].label} vs. ${contestants[1].label}`,
                contestants,
                rollMode,
                prepareModifiers
            });
        }

        const actor = await this.#resolveActorRef(options.actor ?? options.actorUuid);
        if (!actor) return undefined;

        const key = String(options.key ?? options.attribute ?? options.characteristic ?? "").toLowerCase();
        const type = String(options.type ?? options.rollType ?? "").toUpperCase();

        if (type === "SAN_CHECK" || (type === "ATTRIBUTE" && key === "san") || key === "san") {
            return UniversalRollOrchestrator.startSystemRoll("sanity", {
                actor,
                label: options.sanReason || options.label || game.i18n.localize("ROE_COC7.Resources.Sanity"),
                lossSuccess: options.sanMin ?? options.lossSuccess ?? "0",
                lossFailure: options.sanMax ?? options.lossFailure ?? "1d6",
                rollMode,
                prepareModifiers
            });
        }

        if ((type === "ATTRIBUTE" && (key === "lck" || key === "luck")) || key === "lck" || key === "luck") {
            return this.#dispatchLuckCheck(actor, prepareModifiers, rollMode);
        }

        const charKey = CHARACTERISTIC_ALIASES[key];
        if ((type === "CHARACTERISTIC" || charKey) && actor.system?.characteristics?.[charKey]) {
            return this.#dispatchCharacteristic(actor, charKey, difficulty, prepareModifiers, rollMode);
        }

        const skillItem =
            (options.item?.type === "skill" ? options.item : null) ??
            CoC7DataMapper.findActorSkill(actor, { id: options.itemId ?? options.id, name: options.skillName ?? options.name ?? options.key });

        if (skillItem) {
            return UniversalRollOrchestrator.startSystemRoll("skill", {
                actor,
                item: skillItem,
                label: CoC7DataMapper.getSkillLabel(skillItem),
                targetValue: CoC7DataMapper.getSkillValue(skillItem),
                difficulty,
                canPush: skillItem.system?.properties?.push !== false,
                rollMode,
                prepareModifiers
            });
        }

        return undefined;
    }

    static async #handleSanCardCreate(actorUuid, sanData) {
        const actor = await this.#resolveActorRef(actorUuid);
        if (!actor) return undefined;
        const prepareModifiers = Boolean(game.user.isGM && (sanData.isShiftKey || globalThis.event?.shiftKey));
        return UniversalRollOrchestrator.startSystemRoll("sanity", {
            actor,
            label: sanData.sanReason || game.i18n.localize("ROE_COC7.Resources.Sanity"),
            lossSuccess: sanData.sanMin ?? "0",
            lossFailure: sanData.sanMax ?? "1d6",
            rollMode: sanData.isBlind ? "blindroll" : undefined,
            prepareModifiers
        });
    }

    static #onPreCreateChatMessage(message, data) {
        if (!CoC7Settings.isSystemInterceptionEnabled()) return;
        const load = data?.flags?.CoC7?.load ?? message?.flags?.CoC7?.load;
        if (!load?.as || !load.actorUuid) return;

        if (load.as === "CoC7ConCheck") {
            const doc = fromUuidSync(load.actorUuid);
            const actor = doc?.actor ?? doc;
            if (!actor) return;

            const stayAlive = Boolean(load.stayAlive);
            const threshold = Number(actor.system?.characteristics?.con?.value ?? load.dicePool?.threshold ?? 50);
            const conLabel = game.i18n.localize("ROE_COC7.Characteristics.CON.Label");
            const label = stayAlive ? `${conLabel} (${game.i18n.localize("ROE_COC7.Conditions.Dead")})` : conLabel;

            UniversalRollOrchestrator.startSystemRoll("skill", {
                actor,
                label,
                targetValue: threshold,
                difficulty: "regular",
                canChangeDifficulty: false,
                canPush: false,
                isConCheck: true,
                stayAlive,
                rollMode: data?.blind ? "blindroll" : undefined
            });
            return false;
        }

        if (load.as === "CoC7SanCheckCard") {
            this.#handleSanCardCreate(load.actorUuid, {
                sanReason: load.sanReason ?? "",
                sanMin: load.sanMin ?? "0",
                sanMax: load.sanMax ?? "1d6",
                isBlind: Boolean(data?.blind)
            });
            return false;
        }
    }

    static #onPreUpdateActor(actor, changed, options, userId) {
        if (userId !== game.user.id || options?.nreSanityHandled) return;
        if (!CoC7Settings.isSystemInterceptionEnabled()) return;

        const newSan = changed?.system?.attribs?.san?.value;
        if (typeof newSan !== "number") return;

        const oldSan = Number(actor.system?.attribs?.san?.value ?? 0);
        const lost = oldSan - newSan;
        if (lost < 5 || newSan <= 0) return;

        // Avoid duplicating if daily loss already reached the indefinite threshold (1/5 of daily start).
        const previousDailyLoss = Number(actor.system?.attribs?.san?.dailyLoss ?? 0);
        const dailyStartSan = oldSan + previousDailyLoss;
        const twentyPercentThreshold = Math.floor(dailyStartSan / 5);
        if (twentyPercentThreshold > 0 && previousDailyLoss + lost >= twentyPercentThreshold) return;

        const intValue = Number(actor.system?.characteristics?.int?.value ?? 50);
        UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            label: game.i18n.localize("ROE_COC7.Sanity.TemporaryInsanityIntCheck"),
            targetValue: intValue,
            difficulty: "regular",
            canChangeDifficulty: false,
            canPush: false,
            isBoutIntCheck: true
        });
    }

    static async #resolveActorRef(ref) {
        if (!ref) return null;
        if (typeof ref === "string") {
            const doc = await fromUuid(ref);
            return doc?.actor ?? doc ?? game.actors?.get(ref) ?? null;
        }
        return ref.actor ?? ref;
    }

    static #mapNormalizedCheck(actor, entry) {
        const key = String(entry.key ?? entry.characteristic ?? entry.attribute ?? "").toLowerCase();
        if (key === "lck" || key === "luck") {
            return {
                isLuck: true,
                label: game.i18n.localize("ROE_COC7.Resources.Luck"),
                targetValue: Number(actor.system?.attribs?.lck?.value ?? 50),
                canPush: false
            };
        }
        const charKey = CHARACTERISTIC_ALIASES[key];
        if (charKey && actor.system?.characteristics?.[charKey]) {
            return {
                label: game.i18n.localize(`ROE_COC7.Characteristics.${charKey.toUpperCase()}.Label`),
                targetValue: Number(actor.system.characteristics[charKey].value ?? 50),
                canPush: true
            };
        }
        const skillItem =
            (entry.item?.type === "skill" ? entry.item : null) ??
            CoC7DataMapper.findActorSkill(actor, { id: entry.itemId ?? entry.id, name: entry.skillName ?? entry.name ?? entry.key });
        if (skillItem) {
            return {
                itemId: skillItem.id,
                label: CoC7DataMapper.getSkillLabel(skillItem),
                targetValue: CoC7DataMapper.getSkillValue(skillItem),
                canPush: skillItem.system?.properties?.push !== false
            };
        }
        return {
            label: entry.label || entry.name || game.i18n.localize("ROE_COC7.RollSession.Types.basic"),
            targetValue: Number(entry.targetValue ?? entry.value ?? 50),
            canPush: entry.canPush !== false
        };
    }

    static async #onGlobalEnricherClick(event) {
        if (event.button !== 0 || !CoC7Settings.isSystemInterceptionEnabled()) return;
        const link = event.target.closest(ENRICHER_SELECTOR);
        if (!link || link.closest(".roe-overlay")) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const parsed = this.#parseEnricherLink(link);
        const prepareModifiers = Boolean(game.user.isGM && event.shiftKey);
        const promptTitle = parsed.rawName || game.i18n.localize("ROE_COC7.RollSession.Types.basic");
        const actors = await this.#resolveTargetActors(promptTitle);

        for (const actor of actors) {
            await this.#dispatchEnricherForActor(actor, parsed, prepareModifiers);
        }
    }

    static #parseEnricherLink(link) {
        const dataset = link.dataset;
        const rawType = (dataset.type ?? dataset.coc7Type ?? "").toLowerCase();
        const rawName = (
            dataset.name ?? dataset.skill ?? dataset.characteristic ?? dataset.attribute ?? link.textContent ?? ""
        ).replace(/\s*\(.*?\)\s*$/, "").trim();

        const isSanity =
            rawType === "sanloss" || rawType === "sanity" ||
            dataset.sanMax !== undefined || dataset.sanMin !== undefined ||
            /^(san|sanity|stabilität)$/i.test(rawName);

        return { dataset, rawName, isSanity };
    }

    static async #resolveTargetActors(promptTitle) {
        const controlledActors = (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean);
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
        if (/^(lck|luck|glück)$/i.test(rawName)) return this.#dispatchLuckCheck(actor, prepareModifiers);

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

    static #dispatchCharacteristic(actor, charKey, difficulty, prepareModifiers, rollMode = undefined) {
        return UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            label: game.i18n.localize(`ROE_COC7.Characteristics.${charKey.toUpperCase()}.Label`),
            targetValue: Number(actor.system.characteristics[charKey].value ?? 50),
            difficulty,
            canPush: true,
            rollMode,
            prepareModifiers
        });
    }

    static #dispatchLuckCheck(actor, prepareModifiers, rollMode = undefined) {
        return UniversalRollOrchestrator.startSystemRoll("skill", {
            actor,
            label: game.i18n.localize("ROE_COC7.Resources.Luck"),
            targetValue: Number(actor.system?.attribs?.lck?.value ?? 50),
            difficulty: "regular",
            canChangeDifficulty: false,
            canPush: false,
            rollMode,
            prepareModifiers
        });
    }

    static #normalizeDifficulty(raw) {
        const val = String(raw ?? "").toLowerCase();
        if (val === "hard" || val === "1/2" || val === "schwierig") return "hard";
        if (val === "extreme" || val === "1/5" || val === "extrem") return "extreme";
        return "regular";
    }
}
