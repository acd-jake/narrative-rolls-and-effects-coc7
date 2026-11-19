import assert from "assert";
import { describe, it } from "vitest";
import { setCoreApi } from "../module/core-bridge.mjs";
import { RangedWeaponService } from "../module/coc7/ranged/ranged-weapon-service.mjs";
import { RangedCombatRules } from "../module/coc7/ranged/ranged-combat-rules.mjs";
import { CoC7SessionFactory } from "../module/coc7/coc7-session-factory.mjs";
import { RangedRollStrategy } from "../module/coc7/strategies/ranged-roll-strategy.mjs";
import { CoC7SessionPatcher } from "../module/coc7/adapter/coc7-session-patcher.mjs";
import { DamageRollSubmitter } from "../module/coc7/prompts/damage-roll-submitter.mjs";
import { createRangedPromptApp } from "../module/coc7/prompts/ranged-prompt-app.mjs";
import { CoC7CombatResultPresenter } from "../module/coc7/adapter/coc7-combat-result-presenter.mjs";
import { CoC7Settings } from "../module/coc7/coc7-settings.mjs";
import { RangedDamageState } from "../module/coc7/ranged/ranged-damage-state.mjs";
import { CoC7Adapter } from "../module/coc7/coc7-adapter.mjs";

describe("Ranged combat rules and full-auto volleys", () => {
    it("evaluates weapon profiles, modifiers, multi-hit damage, and full-auto volleys", async () => {
        if (!Math.clamp) Math.clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        // ... bestehender Test-Code bis zum Dateiende ...

        if (!Math.clamp) Math.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

        const actors = new Map();
        const uuidActors = new Map();
        globalThis.game = {
            user: { isGM: true, targets: { first: () => null } },
            actors,
            settings: {
                settings: new Map(),
                get: () => false
            },
            i18n: {
                localize: (key) => key,
                format: (key) => key
            }
        };

        const coreApi = {
            session: {
                buildParticipant: (key, actor, label, targetValue, itemId = "") => ({
                    key, actorId: actor?.id ?? "", actorName: actor?.name ?? "", actorImg: "",
                    label, targetValue, itemId, hasRolled: false, total: null, successLevel: "", isSuccess: false
                }),
                resolveActor: (participant) => uuidActors.get(participant?.actorUuid) ?? actors.get(participant?.actorId) ?? null
            }
        };
        setCoreApi(coreApi);

        // 1. Weapon profile & immediate ammo/malfunction updates
        let weaponAmmo = 6;
        const weaponFlags = new Map();
        const revolver = {
            id: "w1",
            name: ".38 Revolver",
            system: {
                ammo: weaponAmmo,
                bullets: 6,
                malfunction: 98,
                usesPerRound: { min: 1, max: 3, burst: 0 },
                properties: { rngd: true, impl: true },
                range: { normal: { value: 15, damage: "1d10" }, long: { value: 30, damage: "1d10" }, extreme: { value: 60, damage: "1d10" } }
            },
            update: async (data) => {
                if ("system.ammo" in data) {
                    weaponAmmo = data["system.ammo"];
                    revolver.system.ammo = weaponAmmo;
                }
            },
            getFlag: (_mod, key) => weaponFlags.get(key),
            setFlag: async (_mod, key, val) => { weaponFlags.set(key, val); },
            unsetFlag: async (_mod, key) => { weaponFlags.delete(key); }
        };

        const profile = RangedWeaponService.getWeaponCombatProfile(revolver, 60);
        assert.equal(profile.tracksAmmo, true);
        assert.equal(profile.ammo, 6);
        assert.equal(profile.maxUses, 3);
        assert.deepEqual(profile.fireModes, ["single", "multiple"]);

        await RangedWeaponService.consumeWeaponAmmo(revolver, 2);
        assert.equal(revolver.system.ammo, 4);

        await RangedWeaponService.reloadWeapon(revolver);
        assert.equal(revolver.system.ammo, 6);

        await RangedWeaponService.setWeaponMalfunction(revolver, true);
        assert.equal(RangedWeaponService.getWeaponCombatProfile(revolver, 60).isJammed, true);
        await RangedWeaponService.setWeaponMalfunction(revolver, false);
        assert.equal(RangedWeaponService.getWeaponCombatProfile(revolver, 60).isJammed, false);
        // 2. Modifier & difficulty progression for multiple shots and full-auto volleys
        const attackerActor = { id: "a1", name: "Investigator", system: { characteristics: { dex: { value: 60 } }, attribs: { hp: { value: 12, max: 12 } } } };
        const defenderActor = { id: "d1", name: "Cultist", system: { attribs: { hp: { value: 10, max: 10 }, armor: { value: 2 }, build: { value: 0 } } } };
        actors.set("a1", attackerActor);
        actors.set("d1", defenderActor);

        const session = CoC7SessionFactory.createRanged({
            attacker: attackerActor,
            target: defenderActor,
            weapon: revolver,
            attackSkillLabel: "Handguns",
            attackTargetValue: 60,
            rangeTier: "long"
        });
        assert.equal(session.difficulty, "hard");
        assert.equal(new CoC7Adapter().buildPreparationTactics({ ...session, isPreparingModifiers: true }).some((tactic) => tactic.key === "aiming"), false);
        const jammedPreparedSession = CoC7SessionFactory.createRanged({
            attacker: attackerActor,
            target: defenderActor,
            weapon: revolver,
            attackSkillLabel: "Handguns",
            attackTargetValue: 60,
            prepareModifiers: true,
            weaponProfile: { ...RangedWeaponService.getWeaponCombatProfile(revolver, 60), isJammed: true }
        });
        assert.equal(jammedPreparedSession.prepareModifiers, false);
        assert.equal(jammedPreparedSession.combatPhase, "attack");

        const attPart = session.participants[0];
        assert.equal(RangedCombatRules.computeModifierDice(session, attPart, { fireMode: "multiple", shotIndex: 0 }), 0);
        assert.equal(RangedCombatRules.computeModifierDice(session, attPart, { fireMode: "multiple", shotIndex: 1 }), -1);

        // Full auto volley overflow into difficulty escalation
        const rawVolley3 = RangedCombatRules.computeModifierDice(session, attPart, { fireMode: "auto", volleyIndex: 3 });
        assert.equal(rawVolley3, -3);
        assert.equal(RangedCombatRules.computeRequiredDifficulty(session, rawVolley3), "extreme");

        // 3. Per-bullet armor mitigation & major wound on multi-hit damage
        const strategy = new RangedRollStrategy();
        const damageState = {
            ...session,
            hitWinnerKey: "attacker",
            rangedHitResults: [
                { targetActorId: "d1", rawDamage: 4, impale: false },
                { targetActorId: "d1", rawDamage: 7, impale: true }
            ]
        };
        await strategy.onRollApplied({ key: "damage", hasRolled: true, total: 11 }, damageState);
        assert.equal(damageState.finalDamage, 7);
        assert.equal(damageState.armorApplied, 4);
        assert.equal(damageState.majorWoundTriggered, true);

        // 4. Token distance & automatic tactical detection
        globalThis.canvas = {
            grid: {
                measurePath: () => ({ distance: 2 })
            },
            tokens: {
                placeables: [
                    { id: "tAtt", actor: attackerActor, center: { x: 0, y: 0 }, document: { disposition: 1 } },
                    { id: "tDef", actor: defenderActor, center: { x: 100, y: 0 }, document: { disposition: -1 } },
                    { id: "tAlly", actor: { id: "a2" }, center: { x: 100, y: 100 }, document: { disposition: 1 } }
                ]
            }
        };
        const detected = RangedWeaponService.detectRangedContext(attackerActor, defenderActor, revolver);
        assert.equal(detected.distance, 2);
        assert.equal(detected.tacticalFlags.pointBlank, true);
        assert.equal(detected.tacticalFlags.inMelee, true);

        console.log("Ranged combat rules checks passed.");

        // Full-auto volleys require damage before another volley can be fired.
        const secondTarget = { id: "d2", name: "Guard", system: { attribs: { hp: { value: 10, max: 10 }, armor: { value: 1 } } } };
        actors.set(secondTarget.id, secondTarget);
        const autoWeapon = {
            id: "auto", name: "Automatic weapon",
            system: {
                ammo: 16, bullets: 16, malfunction: 98, properties: { rngd: true, auto: true, impl: true },
                range: { normal: { damage: "1d6" } }
            },
            update: async function (data) { this.system.ammo = data["system.ammo"]; },
            setFlag: async function () { this.jammed = true; },
            unsetFlag: async function () { this.jammed = false; }
        };
        attackerActor.items = new Map([[autoWeapon.id, autoWeapon]]);
        const firstToken = { id: "first", actor: defenderActor, center: { x: 0, y: 0 } };
        const secondToken = { id: "second", actor: secondTarget, center: { x: 3, y: 0 } };
        canvas.scene = { grid: { units: "m", distance: 1 } };
        canvas.tokens.placeables = [firstToken, secondToken];
        canvas.grid.measurePath = ([a, b]) => ({ distance: Math.abs(a.x - b.x) });
        let autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "auto";
        autoState.participants[1].hasRolled = true;
        let shooter = autoState.participants[0];
        const patcher = new CoC7SessionPatcher();
        game.messages = new Map([["message", {}]]);
        coreApi.session.getSession = () => autoState;
        coreApi.visibility = { getCurrentRollMode: () => "publicroll", canViewParticipantRoll: () => true };
        async function submitDamage(_id, key, data) {
            const participant = autoState.participants.find((entry) => entry.key === key);
            Object.assign(participant, data, { hasRolled: true });
            await strategy.onRollApplied(participant, autoState);
        }
        coreApi.orchestrator = {
            updateSessionPatch: async (_id, patch) => Object.assign(autoState, patch),
            submitParticipantRoll: submitDamage
        };
        globalThis.foundry = { dice: { terms: { Die: class { } } } };
        let nextRollTotal = 4;
        globalThis.Roll = class {
            constructor(formula) { this.formula = formula; this.terms = []; }
            async evaluate(options = {}) { this.total = options.maximize ? 6 : nextRollTotal; return this; }
        };
        assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: 0 }), true);
        Object.assign(shooter, { hasRolled: true, total: 40, successLevel: "regular", rollBreakdown: { modifierDice: 0 } });
        autoState.participants.push(...await strategy.onRollApplied(shooter, autoState));
        assert.equal(autoState.combatPhase, "attack");
        assert.equal(shooter.hasRolled, true);
        assert.equal(autoWeapon.system.ammo, 10);
        assert.equal(autoState.volleyLog[0].roundsHit, 3);
        assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: -1 }), false);
        assert.equal((await patcher.transformSessionPatch(autoState, { stopAutoFire: true })).combatPhase, "attack");
        await DamageRollSubmitter.submit("message", "damage");
        assert.equal(shooter.hasRolled, true);
        assert.equal(autoState.rangedHitResults.length, 3);
        assert.equal(autoState.pendingRangedDamageByActor.d1.damage, 6);
        assert.equal(autoState.rangedDamageByActor.d1.preview, undefined);
        assert.equal(defenderActor.system.attribs.hp.value, 10);
        assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: -1 }), false);
        assert.equal((await patcher.transformSessionPatch(autoState, { stopAutoFire: true })).combatPhase, "attack");
        autoState = await strategy.decideDamageConsequences(autoState, "decline");
        shooter = autoState.participants[0];
        assert.equal(shooter.hasRolled, false);

        autoState = patcher.transformSessionPatch(autoState, { switchRangedTarget: "second" });
        shooter = autoState.participants[0];
        assert.equal(autoState.traversePenaltyDice, 1);
        assert.equal(RangedCombatRules.computeModifierDice(autoState, shooter), -2);
        assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: -1 }), false);
        assert.equal(patcher.validateSubmittedRoll(autoState, shooter, { modifierDice: -2 }), true);
        Object.assign(shooter, { hasRolled: true, total: 10, successLevel: "extreme", rollBreakdown: { modifierDice: -2 } });
        autoState.participants.push(...await strategy.onRollApplied(shooter, autoState));
        assert.equal(autoWeapon.system.ammo, 4);
        assert.equal(autoState.volleyLog[1].roundsHit, 6);
        assert.equal(autoState.rangedHits.filter((hit) => hit.targetKey === "second" && hit.impale).length, 3);
        await DamageRollSubmitter.submit("message", "damage_1");
        assert.equal(autoState.rangedHitResults.length, 9);
        assert.equal(autoState.rangedDamageByActor.d1.damage, 6);
        assert.equal(autoState.rangedDamageByActor.d2.damage, 24);
        assert.equal(secondTarget.system.attribs.hp.value, 10);
        autoState = await strategy.decideDamageConsequences(autoState, "decline");
        shooter = autoState.participants[0];
        const excessiveTraverse = patcher.transformSessionPatch(autoState, { switchRangedTarget: "first" });
        assert.equal(patcher.validateSubmittedRoll(excessiveTraverse, shooter, { modifierDice: -2 }), false);
        autoState = await patcher.transformSessionPatch(autoState, { stopAutoFire: true });
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(autoState.autoFireEnded, true);
        assert.equal(autoState.participants.find((entry) => entry.key === "attacker").hasRolled, true);
        assert.deepEqual(autoState.participants.filter((entry) => entry.key.startsWith("damage")).map((entry) => entry.targetKey), ["first", "second"]);

        // Each target's damage remains available in the resolved summary.
        assert.throws(() => RangedCombatRules.evaluateMultiHitDamage([{ targetActorId: "missing", rawDamage: 4 }], defenderActor));
        const resolvedContext = CoC7CombatResultPresenter.buildResolvedContext(autoState);
        assert.deepEqual(resolvedContext.resolvedRangedDamage.map((entry) => [entry.name, entry.damage]), [["Cultist", 6], ["Guard", 24]]);

        // A partial final volley is legal, and a later malfunction cannot erase earlier hits.
        autoWeapon.system.ammo = 10;
        let jamState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        jamState.combatPhase = "attack";
        jamState.rangedFireMode = "auto";
        jamState.participants[1].hasRolled = true;
        let jamShooter = jamState.participants[0];
        Object.assign(jamShooter, { hasRolled: true, total: 30, successLevel: "hard" });
        jamState.participants.push(...await strategy.onRollApplied(jamShooter, jamState));
        jamState.rangedHitResults = jamState.rangedHits.map((hit) => ({ ...hit, rawDamage: 4 }));
        const firstJamDamage = jamState.participants.find((entry) => entry.key === "damage");
        Object.assign(firstJamDamage, { hasRolled: true, total: 12 });
        await strategy.onRollApplied(firstJamDamage, jamState);
        jamState = await strategy.decideDamageConsequences(jamState, "decline");
        jamShooter = jamState.participants[0];
        Object.assign(jamShooter, { hasRolled: true, total: 99, successLevel: "fumble" });
        const jamDamage = await strategy.onRollApplied(jamShooter, jamState);
        assert.equal(jamState.volleyLog[1].roundsFired, 4);
        assert.equal(autoWeapon.system.ammo, 0);
        assert.equal(autoWeapon.jammed, true);
        assert.equal(jamState.combatPhase, "resolution");
        assert.equal(jamState.hitWinnerKey, "attacker");
        assert.equal(jamDamage.length, 0);

        autoWeapon.system.ammo = 12;
        const missState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        missState.combatPhase = "attack";
        missState.rangedFireMode = "auto";
        missState.participants[1].hasRolled = true;
        const missShooter = missState.participants[0];
        Object.assign(missShooter, { hasRolled: true, total: 95, successLevel: "failure" });
        assert.deepEqual(await strategy.onRollApplied(missShooter, missState), []);
        assert.equal(missShooter.hasRolled, false);
        assert.equal(missState.combatPhase, "attack");
        assert.equal(missState.rangedHits.length, 0);

        autoWeapon.system.ammo = 7;
        let depletedState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        depletedState.combatPhase = "attack";
        depletedState.rangedFireMode = "auto";
        depletedState.participants[1].hasRolled = true;
        const depletedShooter = depletedState.participants[0];
        Object.assign(depletedShooter, { hasRolled: true, total: 40, successLevel: "regular" });
        depletedState.participants.push(...await strategy.onRollApplied(depletedShooter, depletedState));
        assert.equal(depletedState.combatPhase, "attack");
        assert.equal(depletedState.remainingAmmo, 1);
        depletedState.rangedHitResults = depletedState.rangedHits.map((hit) => ({ ...hit, rawDamage: 4 }));
        const depletedDamage = depletedState.participants.find((entry) => entry.key === "damage");
        Object.assign(depletedDamage, { hasRolled: true, total: 12 });
        await strategy.onRollApplied(depletedDamage, depletedState);
        assert.equal(depletedState.combatPhase, "attack");
        depletedState = await strategy.decideDamageConsequences(depletedState, "decline");
        assert.equal(depletedState.combatPhase, "resolution");

        canvas.scene.grid.units = "ft";
        secondToken.center.x = 10;
        assert.equal(RangedCombatRules.measureTraverse(firstToken, secondToken).penalty, 1);
        secondToken.center.x = 8.99;
        assert.equal(RangedCombatRules.measureTraverse(firstToken, secondToken).penalty, 0);
        secondToken.center.x = 10;
        canvas.grid.measurePath = () => ({});
        canvas.grid.measureDistance = () => 10;
        assert.equal(RangedCombatRules.measureTraverse(firstToken, secondToken).penalty, 1);
        canvas.grid.measurePath = ([a, b]) => ({ distance: Math.abs(a.x - b.x) });

        const nestedAmmoWeapon = {
            system: { data: { ammo: 3 }, properties: { auto: true } },
            update: async function (data) { this.system.data.ammo = data["system.data.ammo"]; }
        };
        assert.equal(RangedWeaponService.getWeaponCombatProfile(nestedAmmoWeapon, 30).ammo, 3);
        await RangedWeaponService.consumeWeaponAmmo(nestedAmmoWeapon, 3);
        assert.equal(RangedWeaponService.getWeaponCombatProfile(nestedAmmoWeapon, 30).ammo, 0);
        assert.equal(RangedWeaponService.getWeaponCombatProfile(nestedAmmoWeapon, 30).tracksAmmo, true);

        // Exercise the actual prompt handlers and the cease-fire session patch.
        if (!String.prototype.capitalize) String.prototype.capitalize = function () { return this.charAt(0).toUpperCase() + this.slice(1); };
        class TestPrompt {
            constructor(session) { this.session = session; this._messageId = "message"; }
            async _prepareContext() { return {}; }
            _onRender() { }
            _isDelegatedToActivePlayer() { return false; }
            _formatModifierLabel(value) { return String(value); }
            _formatDiceFormulaLabel() { return ""; }
        }
        const Prompt = createRangedPromptApp({ extendPromptClass: (base) => base }, TestPrompt);
        coreApi.visibility.canViewParticipantRoll = () => true;
        coreApi.diceVisualizer = { getDiceVisuals: () => [] };
        async function submitPromptRoll(_id, key, data) {
            const participant = autoState.participants.find((entry) => entry.key === key);
            assert.equal(patcher.validateSubmittedRoll(autoState, participant, data), true);
            const modifierDice = participant.modifierDice ?? 0;
            Object.assign(participant, data, { modifierDice, hasRolled: true });
            const followUps = await strategy.onRollApplied(participant, autoState);
            autoState.participants.push(...followUps);
        }
        coreApi.orchestrator.submitParticipantRoll = submitPromptRoll;
        coreApi.orchestrator.updateSessionPatch = async (_id, patch) => {
            autoState = await patcher.transformSessionPatch(autoState, patch);
        };
        coreApi.orchestrator.submitConsequenceDecision = async (_id, decision) => {
            if (autoState.pendingDamageKey === decision.participantKey) {
                autoState = await strategy.decideDamageConsequences(autoState, decision.action);
            }
        };

        // Aiming precedes cover, consumes the current round, and affects only the next shot.
        const actorFlags = new Map();
        attackerActor.isOwner = true;
        attackerActor.getFlag = (_scope, key) => actorFlags.get(key);
        attackerActor.setFlag = async (_scope, key, value) => { actorFlags.set(key, value); };
        attackerActor.unsetFlag = async (_scope, key) => { actorFlags.delete(key); };
        const aimWarnings = [];
        globalThis.ui = { notifications: { warn: (message) => aimWarnings.push(message) } };
        game.combat = { id: "combat", started: true, round: 7 };
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        assert.equal(autoState.combatPhase, "aimChoice");
        let aimPrompt = new Prompt(autoState);
        const ammoBeforeAiming = autoWeapon.system.ammo;
        assert.equal((await aimPrompt._prepareContext({})).canChooseRangedAim, true);
        await Prompt.DEFAULT_OPTIONS.actions.chooseCover.call(aimPrompt, null, { dataset: { cover: "true" } });
        assert.equal(autoState.participants[1].hasRolled, false);
        await Prompt.DEFAULT_OPTIONS.actions.chooseRangedAim.call(aimPrompt, null, { dataset: { aim: "start" } });
        assert.equal(autoState.combatPhase, "aiming");
        assert.equal(autoWeapon.system.ammo, ammoBeforeAiming);
        assert.equal(RangedCombatRules.hasSpentRoundAiming(attackerActor), true);
        const competingAttack = { ...autoState, combatPhase: "attack" };
        assert.equal(patcher.validateSubmittedRoll(competingAttack, competingAttack.participants[0], { modifierDice: 0 }), false);
        const competingChoice = { ...autoState, combatPhase: "aimChoice" };
        assert.equal((await patcher.transformSessionPatch(competingChoice, { rangedAimAction: "fire" })).combatPhase, "aimChoice");
        assert.equal(patcher.validateSubmittedRoll(autoState, autoState.participants[1], { modifierDice: 0 }), false);
        await Prompt.DEFAULT_OPTIONS.actions.finishRangedAim.call(aimPrompt);
        assert.equal(autoState.combatPhase, "aiming");
        assert.deepEqual(aimWarnings.pop(), "ROE_COC7.Ranged.AimStillWaiting");
        game.combat.round = 8;
        await Prompt.DEFAULT_OPTIONS.actions.finishRangedAim.call(aimPrompt);
        assert.equal(autoState.combatPhase, "reaction");
        assert.equal(autoState.tacticalFlags.aiming, true);
        assert.equal(RangedCombatRules.hasSpentRoundAiming(attackerActor), false);
        await Prompt.DEFAULT_OPTIONS.actions.chooseCover.call(aimPrompt, null, { dataset: { cover: "false" } });
        assert.equal(autoState.combatPhase, "attack");
        assert.equal(RangedCombatRules.computeModifierDice(autoState, autoState.participants[0], { fireMode: "multiple", shotIndex: 0 }), 1);
        assert.equal(RangedCombatRules.computeModifierDice(autoState, autoState.participants[0], { fireMode: "multiple", shotIndex: 1 }), -1);
        autoWeapon.system.ammo = 12;
        await Prompt.DEFAULT_OPTIONS.actions.setFireMode.call(aimPrompt, null, { dataset: { mode: "multiple" } });
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(aimPrompt);
        assert.equal(autoState.rangedShots.length, 1);
        assert.equal(autoState.rangedShots[0].modifierDice, 1);
        assert.equal(RangedCombatRules.computeModifierDice(autoState, autoState.participants[0], { fireMode: "multiple" }), -1);
        assert.equal(RangedCombatRules.computeModifierDice(autoState, autoState.participants[0], { fireMode: "auto", shotIndex: 1, volleyIndex: 1 }), -1);

        game.combat = null;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60, tacticalFlags: { aiming: true }
        });
        aimPrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.chooseRangedAim.call(aimPrompt, null, { dataset: { aim: "start" } });
        assert.equal(autoState.combatPhase, "aiming");
        assert.equal(RangedCombatRules.hasSpentRoundAiming(attackerActor), true);
        game.user.isGM = false;
        assert.equal((await new Prompt(autoState)._prepareContext({})).canFinishRangedAim, false);
        await Prompt.DEFAULT_OPTIONS.actions.finishRangedAim.call(aimPrompt);
        assert.equal(autoState.combatPhase, "aiming");
        game.user.isGM = true;
        await Prompt.DEFAULT_OPTIONS.actions.finishRangedAim.call(aimPrompt);
        assert.equal(autoState.combatPhase, "reaction");
        assert.equal(autoState.tacticalFlags.aiming, true);
        assert.equal(RangedCombatRules.hasSpentRoundAiming(attackerActor), false);

        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        await Prompt.DEFAULT_OPTIONS.actions.chooseRangedAim.call(new Prompt(autoState), null, { dataset: { aim: "fire" } });
        assert.equal(autoState.combatPhase, "reaction");
        assert.equal(autoState.tacticalFlags.aiming, false);

        autoWeapon.system.ammo = 12;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "auto";
        autoState.participants[1].hasRolled = true;
        const prompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(prompt);
        assert.equal(autoState.volleyCount, 1);
        assert.equal(autoState.combatPhase, "attack");
        const promptContext = await prompt._prepareContext({});
        assert.equal(promptContext.canStopAutoFire, false);
        assert.equal(promptContext.canFireNext, false);
        assert.equal(promptContext.canRollDamage, true);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(prompt);
        prompt.session = autoState;
        const afterDamageContext = await prompt._prepareContext({});
        assert.equal(afterDamageContext.canStopAutoFire, false);
        assert.equal(afterDamageContext.canDecideDamage, true);
        assert.equal(afterDamageContext.damagePreviews[0].status, "ROE_COC7.DamagePreview.Unconscious");
        assert.equal(afterDamageContext.damagePreviews[0].damage, 18);
        assert.equal(afterDamageContext.damagePreviews[0].remainingHp, 0);
        assert.equal(defenderActor.system.attribs.hp.value, 10);
        game.user.isGM = false;
        attackerActor.isOwner = true;
        const playerDamageContext = await prompt._prepareContext({});
        assert.deepEqual(playerDamageContext.damagePreviews, []);
        assert.equal(playerDamageContext.canDecideDamage, false);
        assert.equal(playerDamageContext.canFireNext, false);
        await assert.rejects(Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(prompt, null, { dataset: { decision: "decline" } }), /Only a GM/);
        game.user.isGM = true;
        const queuedDamage = { key: "damage_1", hasRolled: false, actorId: "a1" };
        const queuedState = { ...autoState, combatPhase: "resolution", participants: [...autoState.participants, queuedDamage] };
        assert.equal(patcher.validateSubmittedRoll(queuedState, queuedDamage, { modifierDice: 0 }), false);
        assert.equal((await new Prompt(queuedState)._prepareContext({})).canRollDamage, false);

        const malfunctionNotifications = [];
        const previousFormat = game.i18n.format;
        const previousUserId = game.user.id;
        game.i18n.format = (key, values) => key.startsWith("ROE_COC7.Ranged.MalfunctionClear")
            ? `${key}: ${values.roll}/${values.target}` : key;
        globalThis.ui = {
            notifications: {
                info: (message) => malfunctionNotifications.push(["info", message]),
                warn: (message) => malfunctionNotifications.push(["warn", message])
            }
        };
        const autoStateBeforeMalfunctionTests = autoState;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedMalfunction = true;
        autoWeapon.jammed = true;
        const malfunctionPrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.clearMalfunction.call(malfunctionPrompt);
        assert.equal(autoState.rangedMalfunction, false);
        assert.equal(autoState.isResolved, true);
        assert.equal(autoState.phase, "resolved");
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(autoState.rangedShotsFired, 0);
        assert.deepEqual(autoState.rangedMalfunctionClearResult, {
            total: 4, targetValue: 60, fixed: true, rollMode: "publicroll", rollerUserId: game.user.id
        });
        assert.equal(autoWeapon.jammed, false);
        assert.deepEqual(malfunctionNotifications.pop(), ["info", "ROE_COC7.Ranged.MalfunctionCleared: 4/60"]);
        const successResult = CoC7CombatResultPresenter.buildResolvedContext(autoState);
        assert.equal(successResult.resolvedMalfunctionClear, true);
        assert.equal(successResult.resolvedMalfunctionClearText, "ROE_COC7.Ranged.MalfunctionCleared: 4/60");
        assert.equal(successResult.resolvedActorName, "INVESTIGATOR");
        assert.equal(successResult.resolvedCombatNarrative, undefined);
        const resultAdapter = new CoC7Adapter();
        const autoStatusSession = {
            rollType: "ranged",
            isResolved: true,
            title: "Tommy Gun",
            outcomeHeadline: "Miss",
            resolvedCombatStatus: "ROE_COC7.Ranged.MalfunctionCleared: 4/60",
            participants: [
                { key: "attacker", actorName: "Harvey", hasRolled: true, isSuccess: false },
                { key: "defender", actorName: "Cultist", hasRolled: false }
            ]
        };
        assert.equal((await resultAdapter.prepareResolvedChatContext(autoStatusSession)).resolvedCombatStatus, "ROE_COC7.Ranged.MalfunctionCleared: 4/60");
        assert.equal((await resultAdapter.preparePromptContext(null, autoStatusSession, {})).resolvedCombatStatus, "ROE_COC7.Ranged.MalfunctionCleared: 4/60");

        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedMalfunction = true;
        autoWeapon.jammed = true;
        nextRollTotal = 80;
        game.user.isGM = false;
        game.user.id = "player";
        await Prompt.DEFAULT_OPTIONS.actions.clearMalfunction.call(new Prompt(autoState));
        assert.equal(autoState.rangedMalfunction, true);
        assert.equal(autoState.isResolved, true);
        assert.equal(autoState.rangedShotsFired, 0);
        assert.equal(autoState.rangedMalfunctionClearResult.fixed, false);
        assert.equal(autoState.rangedMalfunctionClearResult.rollerUserId, "player");
        assert.equal(autoWeapon.jammed, true);
        assert.deepEqual(malfunctionNotifications.pop(), ["warn", "ROE_COC7.Ranged.MalfunctionClearFailed: 80/60"]);
        const failureResult = CoC7CombatResultPresenter.buildResolvedContext(autoState);
        assert.equal(failureResult.resolvedMalfunctionClearText, "ROE_COC7.Ranged.MalfunctionClearFailed: 80/60");
        assert.equal(resultAdapter.prepareResolvedChatContext(autoState).resolvedMalfunctionClearText, failureResult.resolvedMalfunctionClearText);
        assert.equal(resultAdapter.preparePromptContext(null, autoState, {}).resolvedMalfunctionClearText, failureResult.resolvedMalfunctionClearText);
        coreApi.visibility.canViewParticipantRoll = () => false;
        assert.equal(CoC7CombatResultPresenter.buildResolvedContext(autoState).resolvedMalfunctionClearText, "ROE.RollSession.HiddenRoll");
        coreApi.visibility.canViewParticipantRoll = () => true;
        game.user.isGM = true;
        const failedClearContext = await new Prompt(autoState)._prepareContext({});
        assert.equal(failedClearContext.canClearMalfunction, false);
        assert.equal(failedClearContext.canFireNext, false);
        await Prompt.DEFAULT_OPTIONS.actions.clearMalfunction.call(new Prompt(autoState));
        assert.equal(autoState.rangedShotsFired, 0);
        assert.equal(malfunctionNotifications.length, 0);

        autoState = { ...autoState, isResolved: false, combatPhase: "attack" };
        autoState.participants.push({ key: "damage_1", hasRolled: false });
        await Prompt.DEFAULT_OPTIONS.actions.clearMalfunction.call(new Prompt(autoState));
        assert.equal(autoState.isResolved, false);
        assert.equal(malfunctionNotifications.length, 0);
        autoState.participants.pop();
        autoState.participants[0].actorId = "missing-attacker";
        await Prompt.DEFAULT_OPTIONS.actions.clearMalfunction.call(new Prompt(autoState));
        assert.deepEqual(malfunctionNotifications.pop(), ["warn", "ROE_COC7.Ranged.MalfunctionClearUnavailable"]);
        autoState.participants[0].actorId = attackerActor.id;
        autoState.weaponId = "missing-weapon";
        await Prompt.DEFAULT_OPTIONS.actions.clearMalfunction.call(new Prompt(autoState));
        assert.deepEqual(malfunctionNotifications.pop(), ["warn", "ROE_COC7.Ranged.MalfunctionClearUnavailable"]);
        nextRollTotal = 4;
        game.i18n.format = previousFormat;
        game.user.id = previousUserId;
        autoState = autoStateBeforeMalfunctionTests;

        // Foundry expands old UUID map keys; read them and prefer the newer escaped entry.
        function makeDamageTarget(uuid) {
            return {
                id: "d1", uuid, system: { attribs: { hp: { value: 10, max: 10 }, armor: { value: 0 } } },
                statuses: new Set(), updates: 0,
                async update(data) { this.updates++; this.system.attribs.hp.value = data["system.attribs.hp.value"]; },
                async toggleStatusEffect(status) { this.statuses.add(status); }
            };
        }
        const worldTarget = makeDamageTarget("Actor.d1");
        const tokenTarget = makeDamageTarget("Scene.scene.Token.token.Actor.d1");
        uuidActors.set(worldTarget.uuid, worldTarget);
        uuidActors.set(tokenTarget.uuid, tokenTarget);
        const worldDamage = { actorId: "d1", actorUuid: worldTarget.uuid, damage: 4, majorWound: false, fatalHit: false };
        const tokenDamage = { actorId: "d1", actorUuid: tokenTarget.uuid, damage: 2, majorWound: false, fatalHit: false };
        const calculated = RangedCombatRules.evaluateMultiHitDamage([
            { targetActorUuid: worldTarget.uuid, targetActorId: "d1", rawDamage: 4 }
        ], worldTarget);
        assert.ok(calculated.damageByActor["Actor%2Ed1"]);
        assert.equal(Object.keys(calculated.damageByActor)[0].includes("."), false);
        const legacyDamage = {
            Actor: { d1: { ...worldDamage, damage: 1 } },
            Scene: { scene: { Token: { token: { Actor: { d1: tokenDamage } } } } },
            "Actor%2Ed1": worldDamage,
            d1: { damage: 1 }
        };
        const compatibilityState = {
            ...autoState,
            pendingDamageKey: "",
            rangedDamageDecisionStarted: false,
            hasPendingConsequences: true,
            rangedDamageByActor: legacyDamage,
            rangedHits: [
                { targetKey: "first", targetActorId: "d1", targetActorUuid: worldTarget.uuid, targetName: "World target" },
                { targetKey: "second", targetActorId: "d1", targetActorUuid: tokenTarget.uuid, targetName: "Token target" }
            ],
            rangedCoverTargets: []
        };
        const compatibilityPrompt = new Prompt(compatibilityState);
        const compatibilityContext = await compatibilityPrompt._prepareContext({});
        const legacyAdapter = new CoC7Adapter();
        assert.equal(legacyAdapter.canResolveSession(compatibilityState), false);
        assert.equal(patcher.validateSubmittedRoll(compatibilityState, compatibilityState.participants[0], { modifierDice: -1 }), false);
        const discardedLegacy = await legacyAdapter.handleConsequenceDecision(compatibilityState, {
            action: "decline", participantKey: "damage"
        });
        assert.equal(discardedLegacy.rangedDamageDecisionStarted, true);
        assert.equal(discardedLegacy.hasPendingConsequences, false);
        assert.equal(worldTarget.system.attribs.hp.value, 10);
        assert.deepEqual(compatibilityContext.damagePreviews.map((entry) => [entry.name, entry.damage, entry.remainingHp]), [
            ["World target", 4, 6], ["Token target", 2, 8]
        ]);
        const absorbedState = {
            ...compatibilityState,
            rangedDamageByActor: { "Actor%2Ed1": { ...worldDamage, damage: 0 } }
        };
        const absorbedContext = await new Prompt(absorbedState)._prepareContext({});
        assert.equal(absorbedContext.damagePreviews[0].damage, 0);
        assert.equal(absorbedContext.damagePreviews[0].remainingHp, 10);
        assert.equal(absorbedContext.damagePreviews[0].status, "ROE_COC7.DamagePreview.NoDamage");
        assert.deepEqual(CoC7CombatResultPresenter.buildResolvedContext(compatibilityState).resolvedRangedDamage.map((entry) => [entry.name, entry.damage]), [
            ["World target", 4], ["Token target", 2]
        ]);
        game.user.isGM = false;
        const hiddenConditions = CoC7CombatResultPresenter.buildResolvedContext({
            ...compatibilityState, majorWoundTriggered: true,
            rangedDamageByActor: { d1: { ...worldDamage, majorWound: true } }
        });
        assert.equal(hiddenConditions.resolvedMajorWound, false);
        assert.equal(hiddenConditions.resolvedRangedDamage[0].majorWound, false);
        game.user.isGM = true;
        await strategy.applyConsequences(compatibilityState);
        assert.equal(worldTarget.system.attribs.hp.value, 6);
        assert.equal(tokenTarget.system.attribs.hp.value, 8);
        assert.equal(worldTarget.updates, 1);
        assert.equal(tokenTarget.updates, 1);
        const uuidOnlyState = {
            ...compatibilityState,
            rangedDamageByActor: { Actor: { d1: { damage: 2, majorWound: false } } }
        };
        assert.equal((await new Prompt(uuidOnlyState)._prepareContext({})).damagePreviews[0].remainingHp, 4);
        assert.equal(RangedDamageState.entries({ d1: { damage: 3 } })[0].actorId, "d1");

        // A missing synthetic target must not fall back to its world actor or crash the prompt.
        const missingUuid = "Scene.missing.Token.token.Actor.d1";
        const unavailableState = {
            ...compatibilityState,
            rangedDamageByActor: { [RangedDamageState.storageKey(missingUuid)]: { actorId: "d1", actorUuid: missingUuid, damage: 2 } },
            rangedHits: [{ targetActorId: "d1", targetActorUuid: missingUuid, targetName: "Unavailable target" }]
        };
        const unavailablePrompt = new Prompt(unavailableState);
        const unavailablePreview = (await unavailablePrompt._prepareContext({})).damagePreviews[0];
        assert.equal(unavailablePreview.status, "ROE_COC7.DamagePreview.Unavailable");
        assert.equal(unavailablePreview.showHp, false);
        await assert.rejects(strategy.applyConsequences(unavailableState), /target actor .* is unavailable/);
        assert.equal(defenderActor.system.attribs.hp.value, 10);
        const partiallyUnavailableState = {
            ...unavailableState,
            rangedDamageByActor: { "Actor%2Ed1": worldDamage, ...unavailableState.rangedDamageByActor }
        };
        await assert.rejects(strategy.applyConsequences(partiallyUnavailableState), /target actor .* is unavailable/);
        assert.equal(worldTarget.updates, 1);
        assert.equal((await unavailablePrompt._prepareContext({})).damagePreviews[0].status, "ROE_COC7.DamagePreview.Unavailable");

        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(prompt, null, { dataset: { decision: "decline" } });
        prompt.session = autoState;
        assert.equal(autoState.participants[0].hasRolled, false);
        assert.equal(defenderActor.system.attribs.hp.value, 10);
        prompt.element = { querySelector: () => ({ value: "second" }) };
        game.user.targets = new Set([secondToken]);
        await Prompt.DEFAULT_OPTIONS.actions.switchRangedTarget.call(prompt);
        assert.equal(autoState.rangedTargetTokenId, "second");
        assert.equal(autoState.traversePenaltyDice, 1);
        assert.equal(patcher.validateSubmittedRoll(autoState, autoState.participants[0], { modifierDice: -2 }), true);
        prompt.session = autoState;
        await Prompt.DEFAULT_OPTIONS.actions.stopAutoFire.call(prompt);
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(autoState.participants.filter((entry) => entry.key === "damage").length, 1);
        prompt.session = autoState;
        function verifyDamageDice(config) {
            if (config.rollType === "other") assert.equal(config.diceFormula, "1d6");
            return [];
        }
        coreApi.diceVisualizer.getDiceVisuals = verifyDamageDice;
        assert.equal((await prompt._prepareContext({})).canRollDamage, false);
        coreApi.diceVisualizer.getDiceVisuals = () => [];

        autoWeapon.system.ammo = 12;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.participants[1].hasRolled = true;
        const singlePrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(singlePrompt);
        assert.equal(autoState.rangedShotsFired, 1);
        assert.equal(autoState.combatPhase, "attack");
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(singlePrompt);
        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(singlePrompt, null, { dataset: { decision: "decline" } });
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(autoWeapon.system.ammo, 11);

        // Multiple single shots also pause for damage and permit changing targets.
        attackerActor.items.set(revolver.id, revolver);
        revolver.system.ammo = 6;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: revolver,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "multiple";
        autoState.participants[1].hasRolled = true;
        const multiplePrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(multiplePrompt);
        assert.equal((await multiplePrompt._prepareContext({})).canFireNext, false);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(multiplePrompt);
        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(multiplePrompt, null, { dataset: { decision: "decline" } });
        multiplePrompt.session = autoState;
        multiplePrompt.element = { querySelector: () => ({ value: "second" }) };
        await Prompt.DEFAULT_OPTIONS.actions.switchRangedTarget.call(multiplePrompt);
        assert.equal(autoState.rangedTargetTokenId, "second");
        assert.equal(autoState.traversePenaltyDice, 0);
        multiplePrompt.session = autoState;
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(multiplePrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(multiplePrompt);
        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(multiplePrompt, null, { dataset: { decision: "decline" } });
        assert.equal(autoState.rangedHitResults.length, 2);
        assert.equal(autoState.rangedHitResults[0].targetActorId, "d1");
        assert.equal(autoState.rangedHitResults[1].targetActorId, "d2");
        assert.equal(autoState.combatPhase, "attack");
        await Prompt.DEFAULT_OPTIONS.actions.finishRangedAttack.call(multiplePrompt);
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(CoC7CombatResultPresenter.buildResolvedContext(autoState).resolvedCombatNarrative, "ROE_COC7.Ranged.ResolvedNarrative.MultiTargetHit");

        // World policy takes precedence over the local automatic-damage preference.
        let policy = "client";
        let automatic = true;
        let autoApply = false;
        game.user.id = "shooter";
        function readTestSetting(_module, key) {
            if (key === "rangedDamageRollPolicy") return policy;
            if (key === "automaticRangedDamage") return automatic;
            if (key === "autoApplyRollConsequences") return autoApply;
            return false;
        }
        game.settings.get = readTestSetting;
        assert.equal(CoC7Settings.shouldAutoRollRangedDamage(), true);
        policy = "manual";
        assert.equal(CoC7Settings.shouldAutoRollRangedDamage(), false);
        policy = "automatic";
        automatic = false;
        assert.equal(CoC7Settings.shouldAutoRollRangedDamage(), true);
        policy = "manual";
        automatic = true;
        autoWeapon.system.ammo = 12;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "auto";
        autoState.participants[1].hasRolled = true;
        const automaticPrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(automaticPrompt);
        automaticPrompt._onRender({}, {});
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(autoState.participants.find((entry) => entry.key === "damage").hasRolled, false);
        policy = "automatic";
        automatic = false;
        automaticPrompt._onRender({}, {});
        automaticPrompt._onRender({}, {});
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(autoState.participants.find((entry) => entry.key === "damage").hasRolled, true);
        assert.equal(autoState.rangedHitResults.length, 6);
        assert.equal(autoState.participants.find((entry) => entry.key === "attacker").hasRolled, true);
        assert.equal(autoState.pendingDamageKey, "damage");

        // Consecutive decisions apply only their own shot, even when a middle shot is discarded.
        let manualUpdates = 0;
        defenderActor.statuses = new Set();
        defenderActor.update = async function (data) {
            manualUpdates++;
            this.system.attribs.hp.value = data["system.attribs.hp.value"];
        };
        defenderActor.toggleStatusEffect = async function (status) { this.statuses.add(status); };
        globalThis.Hooks = { callAll: () => { } };
        policy = "manual";
        revolver.system.ammo = 6;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: revolver,
            attackSkillLabel: "Handguns", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "multiple";
        autoState.participants[1].hasRolled = true;
        const decisionPrompt = new Prompt(autoState);
        for (const [decision, expectedHp] of [["apply", 6], ["decline", 6], ["apply", 2]]) {
            decisionPrompt.session = autoState;
            await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(decisionPrompt);
            await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(decisionPrompt);
            decisionPrompt.session = autoState;
            assert.equal((await decisionPrompt._prepareContext({})).canFireNext, false);
            await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(decisionPrompt, null, { dataset: { decision } });
            assert.equal(defenderActor.system.attribs.hp.value, expectedHp);
        }
        assert.equal(manualUpdates, 2);
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(autoState.consequencesApplied, true);
        await strategy.applyConsequences(autoState);
        assert.equal(manualUpdates, 2);
        assert.equal(autoState.rangedDamageByActor.d1.damage, 12);

        // Damage decisions remain separate after switching to another target.
        manualUpdates = 0;
        defenderActor.system.attribs.hp.value = 10;
        secondTarget.statuses = new Set();
        secondTarget.update = async function (data) { this.system.attribs.hp.value = data["system.attribs.hp.value"]; };
        secondTarget.toggleStatusEffect = async function (status) { this.statuses.add(status); };
        revolver.system.ammo = 6;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: revolver,
            attackSkillLabel: "Handguns", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "multiple";
        autoState.participants[1].hasRolled = true;
        const switchPrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(switchPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(switchPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(switchPrompt, null, { dataset: { decision: "apply" } });
        switchPrompt.session = autoState;
        switchPrompt.element = { querySelector: () => ({ value: "second" }) };
        await Prompt.DEFAULT_OPTIONS.actions.switchRangedTarget.call(switchPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(switchPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(switchPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.decideDamage.call(switchPrompt, null, { dataset: { decision: "apply" } });
        await Prompt.DEFAULT_OPTIONS.actions.finishRangedAttack.call(switchPrompt);
        assert.equal(defenderActor.system.attribs.hp.value, 6);
        assert.equal(secondTarget.system.attribs.hp.value, 5);
        await strategy.applyConsequences(autoState);
        assert.equal(defenderActor.system.attribs.hp.value, 6);
        assert.equal(secondTarget.system.attribs.hp.value, 5);

        // Automatic consequence application occurs before the next volley and is not repeated at cease fire.
        autoApply = true;
        let hpUpdates = 0;
        defenderActor.system.attribs.hp.value = 10;
        defenderActor.statuses = new Set();
        defenderActor.update = async function (data) {
            hpUpdates++;
            this.system.attribs.hp.value = data["system.attribs.hp.value"];
        };
        defenderActor.toggleStatusEffect = async function (status) { this.statuses.add(status); };
        globalThis.Hooks = { callAll: () => { } };
        autoWeapon.system.ammo = 12;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "auto";
        autoState.participants[1].hasRolled = true;
        const applyPrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(applyPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(applyPrompt);
        assert.equal(hpUpdates, 1);
        assert.equal(defenderActor.system.attribs.hp.value, 0);
        assert.equal(autoState.pendingDamageKey, "");
        await Prompt.DEFAULT_OPTIONS.actions.stopAutoFire.call(applyPrompt);
        assert.equal(hpUpdates, 1);
        assert.equal(defenderActor.system.attribs.hp.value, 0);
        assert.equal(defenderActor.statuses.has("unconscious"), true);
        assert.equal(defenderActor.statuses.has("dead"), false);
        assert.equal(autoState.hasPendingConsequences, false);

        // Automatic damage applies each volley exactly once, including the final volley.
        hpUpdates = 0;
        defenderActor.system.attribs.hp.value = 100;
        defenderActor.system.attribs.hp.max = 100;
        defenderActor.statuses.clear();
        autoWeapon.system.ammo = 12;
        autoState = CoC7SessionFactory.createRanged({
            attacker: attackerActor, target: defenderActor, targetToken: firstToken, weapon: autoWeapon,
            attackSkillLabel: "Firearms", attackTargetValue: 60
        });
        autoState.combatPhase = "attack";
        autoState.rangedFireMode = "auto";
        autoState.participants[1].hasRolled = true;
        const autoSeriesPrompt = new Prompt(autoState);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(autoSeriesPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(autoSeriesPrompt);
        assert.equal(defenderActor.system.attribs.hp.value, 82);
        assert.equal(autoState.participants[0].hasRolled, false);
        await Prompt.DEFAULT_OPTIONS.actions.executeRoll.call(autoSeriesPrompt);
        await Prompt.DEFAULT_OPTIONS.actions.executeDamageRoll.call(autoSeriesPrompt);
        assert.equal(defenderActor.system.attribs.hp.value, 64);
        assert.equal(hpUpdates, 2);
        assert.equal(autoState.combatPhase, "resolution");
        assert.equal(autoState.consequencesApplied, true);
        await strategy.applyConsequences(autoState);
        assert.equal(hpUpdates, 2);
        console.log("Full-auto volley checks passed.");
    });
});