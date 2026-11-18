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
        const unconscious = !dead && (damage > 0 && remainingHp === 0 || Boolean(targetActor.statuses?.has?.("unconscious")));
        const hasMajorWound = Boolean(damage > 0 && majorWoundTriggered || targetActor.statuses?.has?.("criticalWounds"));
        return {
            damage, currentHp: Number(hp.value), remainingHp, dead, unconscious,
            dying: Boolean(targetActor.statuses?.has?.("dying")) || damage > 0 && !dead && remainingHp === 0 && hasMajorWound,
            majorWound: damage > 0 && !dead && Boolean(majorWoundTriggered),
            hasMajorWound: !dead && hasMajorWound,
            incapacitated: dead || unconscious
        };
    }

    /** Formats the predicted condition without treating an unrolled consciousness check as a failure. */
    static formatPreview(preview) {
        const status = preview.dead ? "Dead" : preview.dying ? "Dying"
            : preview.unconscious ? "Unconscious" : preview.majorWound ? "MajorWound"
                : preview.damage === 0 ? "NoDamage" : "Active";
        const label = game.i18n.localize(`ROE_COC7.DamagePreview.${status}`);
        if (!preview.hasMajorWound || status === "MajorWound") return label;
        return `${label}; ${game.i18n.localize("ROE_COC7.DamagePreview.MajorWoundStatus")}`;
    }

    /** Applies damage and the resulting wound or incapacitation conditions to an actor. */
    static async applyDamageToActor(targetActor, finalDamage, majorWoundTriggered = false, fatalHit = null) {
        const dmg = Number(finalDamage ?? 0);
        if (!targetActor || dmg <= 0) return;

        const preview = this.previewDamage(targetActor, dmg, majorWoundTriggered, fatalHit);
        await targetActor.update({ "system.attribs.hp.value": preview.remainingHp });
        if (preview.dead) {
            await CoC7DataMapper.setCondition(targetActor, "dead", true);
        } else {
            if (preview.majorWound) await CoC7DataMapper.setCondition(targetActor, "majorWound", true);
            if (preview.remainingHp === 0) {
                await CoC7DataMapper.setCondition(targetActor, "unconscious", true);
                if (preview.dying) await CoC7DataMapper.setCondition(targetActor, "dying", true);
            }
        }
    }
}
