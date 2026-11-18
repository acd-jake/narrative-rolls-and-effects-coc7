import { RangedWeaponService } from "./ranged/ranged-weapon-service.mjs";

/** Adapts common actor, skill, resource, and condition data to the CoC7 system schema. */
export class CoC7DataMapper {
    static getSkillValue(skillItem) {
        return Number(skillItem?.system?.value ?? skillItem?.system?.total ?? 0);
    }

    static getSkillLabel(skillItem) {
        if (!skillItem) return "";
        const base = skillItem.system?.skillName || skillItem.name;
        const spec = (skillItem.system?.specialization ?? "").trim();
        return spec && !base.includes(`(${spec})`) ? `${base} - ${spec}` : skillItem.name;
    }

    static getResource(actor, key) {
        const map = { hp: "hp", mp: "mp", sanity: "san", luck: "lck" };
        return actor?.system?.attribs?.[map[key]] ?? null;
    }

    static getCombatValue(actor, key) {
        const map = { damageBonus: "db", build: "build", armor: "armor", mov: "mov" };
        return actor?.system?.attribs?.[map[key]]?.value ?? null;
    }

    static findActorSkill(actor, { id = "", name = "" } = {}) {
        const skills = actor?.items?.filter((i) => i.type === "skill") ?? [];
        if (id) {
            const byId = skills.find((s) => s.id === id);
            if (byId) return byId;
        }
        const clean = (name ?? "").replace(/^skill\./i, "").trim().toLowerCase();
        return clean ? skills.find((s) => s.name.toLowerCase() === clean) ?? null : null;
    }

    static resolveWeaponAttack(attacker, weapon) {
        const mainSkill = weapon.system?.skill?.main;
        const attackSkill =
            this.findActorSkill(attacker, { id: mainSkill?.id, name: mainSkill?.name }) ??
            this.findActorSkill(attacker, { name: game.i18n.localize("ROE_COC7.SkillList.FightingBrawl") });

        const attackerToken = canvas?.tokens?.controlled?.find((t) => t.actor?.id === attacker?.id) ?? null;
        const targetToken = game.user.targets.first() ?? null;
        const defender = targetToken?.actor ?? null;
        const isRanged = Boolean(weapon.system?.properties?.rngd);
        const attackTargetValue = attackSkill ? this.getSkillValue(attackSkill) : 25;

        const base = {
            attacker,
            defender,
            target: defender,
            attackerToken,
            targetToken,
            weapon,
            isRanged,
            attackSkillLabel: attackSkill ? this.getSkillLabel(attackSkill) : weapon.name,
            attackTargetValue,
            difficulty: "regular"
        };

        if (!isRanged) return base;

        const weaponProfile = RangedWeaponService.getWeaponCombatProfile(weapon, attackTargetValue);
        const detected = RangedWeaponService.detectRangedContext(attacker, defender, weapon, { attackerToken, targetToken });
        return { ...base, weaponProfile, ...detected };
    }

    static async setCondition(actor, conditionKey, active) {
        if (!actor) return;
        const statusMap = {
            majorWound: "criticalWounds",
            temporaryInsanity: "tempoInsane",
            indefiniteInsanity: "indefInsane",
            unconscious: "unconscious",
            dying: "dying",
            dead: "dead",
            prone: "prone"
        };
        const coc7Status = statusMap[conditionKey] ?? conditionKey;
        if (typeof actor.toggleStatusEffect === "function") {
            const isCurrentlyActive = actor.statuses?.has(coc7Status) ?? false;
            if (isCurrentlyActive !== active) {
                await actor.toggleStatusEffect(coc7Status, { active });
            }
        }
        if (active) {
            Hooks.callAll("roeConditionTriggered", actor, conditionKey);
        }
    }
}
