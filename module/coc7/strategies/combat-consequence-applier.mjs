import { CoC7DataMapper } from "../coc7-data-mapper.mjs";

/** Shared HP deduction and wound/death condition helper for melee and ranged strategies. */
export class CombatConsequenceApplier {
    /** Calculates the HP and conditions that applying damage would produce without changing the actor. */
    static previewDamage(targetActor, finalDamage, majorWoundTriggered = false, fatalHit = null) {
        if (!targetActor) throw new Error("Cannot preview damage without a target actor.");
        const hp = CoC7DataMapper.getResource(targetActor, "hp");
        if (!hp || !Number.isFinite(Number(hp.value)) || !Number.isFinite(Number(hp.max))) {
            throw new Error("Cannot preview damage without valid target hit points.");
        }
        const damage = Math.max(0, Number(finalDamage ?? 0));
        const remainingHp = Math.max(0, Number(hp.value) - damage);
        const dead = Boolean(targetActor.statuses?.has?.("dead")) || damage > 0 && (fatalHit ?? damage >= Number(hp.max));
        const unconscious = !dead && (remainingHp === 0 || Boolean(targetActor.statuses?.has?.("unconscious")));
        const hasMajorWound = Boolean(majorWoundTriggered || targetActor.statuses?.has?.("criticalWounds"));
        return {
            currentHp: Number(hp.value), remainingHp, dead, unconscious,
            dying: Boolean(targetActor.statuses?.has?.("dying")) || !dead && remainingHp === 0 && hasMajorWound,
            majorWound: damage > 0 && !dead && remainingHp > 0 && Boolean(majorWoundTriggered),
            incapacitated: dead || unconscious
        };
    }

    /** Formats the predicted condition without treating an unrolled consciousness check as a failure. */
    static formatPreview(preview) {
        const status = preview.dead ? "Dead" : preview.dying ? "Dying"
            : preview.unconscious ? "Unconscious" : preview.majorWound ? "MajorWound" : "Active";
        return game.i18n.localize(`ROE_COC7.DamagePreview.${status}`);
    }

    /** Applies damage and the resulting wound or incapacitation conditions to an actor. */
    static async applyDamageToActor(targetActor, finalDamage, majorWoundTriggered = false, fatalHit = null) {
        const dmg = Number(finalDamage ?? 0);
        if (!targetActor || dmg <= 0) return;

        const preview = this.previewDamage(targetActor, dmg, majorWoundTriggered, fatalHit);
        await targetActor.update({ "system.attribs.hp.value": preview.remainingHp });
        if (preview.dead) {
            await CoC7DataMapper.setCondition(targetActor, "dead", true);
        } else if (preview.remainingHp === 0) {
            await CoC7DataMapper.setCondition(targetActor, "unconscious", true);
            if (preview.dying) {
                await CoC7DataMapper.setCondition(targetActor, "dying", true);
            }
        } else if (preview.majorWound) {
            await CoC7DataMapper.setCondition(targetActor, "majorWound", true);
        }
    }
}
