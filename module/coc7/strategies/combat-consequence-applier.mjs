import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/** Shared HP deduction and wound/death condition helper for melee and ranged strategies. */
export class CombatConsequenceApplier {
    static async applyDamageToActor(targetActor, finalDamage, majorWoundTriggered = false) {
        const dmg = Number(finalDamage ?? 0);
        if (!targetActor || dmg <= 0) return;

        const hpResource = CoC7DataMapper.getResource(targetActor, "hp") ?? {};
        const currentHp = Number(hpResource.value ?? 0);
        const maxHp = Number(hpResource.max ?? 10);
        const newHp = Math.max(0, currentHp - dmg);

        await targetActor.update({ "system.attribs.hp.value": newHp });

        if (dmg >= maxHp) {
            await CoC7DataMapper.setCondition(targetActor, "dead", true);
        } else if (newHp === 0) {
            await CoC7DataMapper.setCondition(targetActor, "unconscious", true);
            if (majorWoundTriggered) {
                await CoC7DataMapper.setCondition(targetActor, "dying", true);
            }
        } else if (majorWoundTriggered) {
            await CoC7DataMapper.setCondition(targetActor, "majorWound", true);
        }
    }
}
