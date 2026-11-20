import { COC7_MODULE_ID } from "../coc7-settings.mjs";

/** Handles CoC 7e ranged weapon profiles, token distance checks, ammo updates, and malfunctions. */
export class RangedWeaponService {
    /** Reads relevant CoC7 world rules for ammo and shots per round. */
    static getWorldCombatRules() {
        const readBool = (key) => {
            if (!game.settings?.settings?.has?.(`CoC7.${key}`)) return false;
            return Boolean(game.settings.get("CoC7", key));
        };
        return {
            disregardAmmo: readBool("disregardAmmo"),
            disregardUsePerRound: readBool("disregardUsePerRound")
        };
    }

    /** Extracts ammo, fire modes, and malfunction thresholds from a CoC7 weapon item. */
    static getWeaponCombatProfile(weapon, skillValue = 0) {
        const sys = weapon?.system ?? {};
        const props = sys.properties ?? {};
        const uses = sys.usesPerRound ?? {};
        const rules = this.getWorldCombatRules();

        const bullets = Math.max(0, Number(sys.bullets ?? 0));
        const ammoValue = sys.ammo ?? sys.data?.ammo;
        const rawAmmo = ammoValue !== undefined && ammoValue !== null ? Number(ammoValue) : bullets;
        const tracksAmmo = !rules.disregardAmmo && (bullets > 0 || ammoValue !== undefined && ammoValue !== null);
        const ammo = tracksAmmo ? Math.max(0, rawAmmo) : null;

        const maxUses = Math.max(1, Number(uses.max ?? 1) || 1);
        const burstSize = Math.max(0, Number(uses.burst ?? 0) || 0);
        const hasBurst = Boolean(props.brst && burstSize > 1);
        const hasAuto = Boolean(props.auto);
        const autoVolleySize = hasAuto ? Math.max(3, Math.floor(Number(skillValue) / 10)) : 0;

        const fireModes = ["single"];
        if (rules.disregardUsePerRound || maxUses > 1) fireModes.push("multiple");
        if (hasBurst) fireModes.push("burst");
        if (hasAuto) fireModes.push("auto");

        const rawMalfunction = Number(sys.malfunction ?? 100);
        const isValidMalfunction = Number.isFinite(rawMalfunction) && rawMalfunction > 0 && !(rawMalfunction > 100);
        const malfunctionThreshold = isValidMalfunction ? rawMalfunction : 100;
        const isJammed = Boolean(weapon?.getFlag?.(COC7_MODULE_ID, "jammed") || weapon?.flags?.[COC7_MODULE_ID]?.jammed);

        return {
            tracksAmmo,
            ammo,
            ammoMax: bullets,
            maxUses: rules.disregardUsePerRound ? 99 : maxUses,
            burstSize,
            hasBurst,
            hasAuto,
            autoVolleySize,
            fireModes,
            malfunctionThreshold,
            isJammed,
            isImpaling: Boolean(props.impl && !props.shotgun),
            isShotgun: Boolean(props.shotgun),
            baseRange: Math.max(0, Number(sys.range?.normal?.value ?? 0) || 0),
            longRange: Math.max(0, Number(sys.range?.long?.value ?? 0) || 0),
            extremeRange: Math.max(0, Number(sys.range?.extreme?.value ?? 0) || 0),
            normalDamage: sys.range?.normal?.damage || "1d6",
            longDamage: sys.range?.long?.damage || sys.range?.normal?.damage || "1d6",
            extremeDamage: sys.range?.extreme?.damage || sys.range?.normal?.damage || "1d6"
        };
    }

    /** Measures canvas distance between two tokens or actors in scene grid units. */
    static measureTokenDistance(sourceTokenOrActor, targetTokenOrActor) {
        const resolveToken = (entity) => {
            if (!entity) return null;
            if (entity.center || entity.document?.x !== undefined) return entity;
            if (entity.token?.object) return entity.token.object;
            return canvas?.tokens?.placeables?.find((t) => t.actor?.id === entity.id) ?? null;
        };

        const tokenA = resolveToken(sourceTokenOrActor);
        const tokenB = resolveToken(targetTokenOrActor);
        if (!tokenA || !tokenB || !canvas?.grid) return null;

        try {
            const pointA = tokenA.center ?? { x: tokenA.x ?? 0, y: tokenA.y ?? 0 };
            const pointB = tokenB.center ?? { x: tokenB.x ?? 0, y: tokenB.y ?? 0 };
            if (typeof canvas.grid.measurePath === "function") {
                const path = canvas.grid.measurePath([pointA, pointB]);
                const dist = Number(path?.distance ?? path?.cost);
                if (Number.isFinite(dist)) return Math.max(0, Math.round(dist * 10) / 10);
            }
            if (typeof canvas.grid.measureDistance === "function") {
                const dist = Number(canvas.grid.measureDistance(pointA, pointB, { gridSpaces: true }));
                if (Number.isFinite(dist)) return Math.max(0, Math.round(dist * 10) / 10);
            }
        } catch (_err) {
            return null;
        }
        return null;
    }
    /** Infers range tier and CoC 7e ranged tactical flags from Foundry tokens and actors. */
    static detectRangedContext(attacker, defender, weapon, { attackerToken = null, targetToken = null } = {}) {
        const profile = this.getWeaponCombatProfile(weapon);
        const distance = this.measureTokenDistance(attackerToken ?? attacker, targetToken ?? defender);
        const dex = Number(attacker?.system?.characteristics?.dex?.value ?? 50);
        const pointBlankThreshold = Math.max(1, Math.floor(dex / 5));

        let rangeTier = "normal";
        let pointBlank = false;
        if (distance !== null && profile.baseRange > 0) {
            if (distance <= pointBlankThreshold) {
                pointBlank = true;
                rangeTier = "normal";
            } else if (distance <= profile.baseRange) {
                rangeTier = "normal";
            } else if (distance <= (profile.longRange || profile.baseRange * 2)) {
                rangeTier = "long";
            } else {
                rangeTier = "extreme";
            }
        }

        const build = Number(defender?.system?.attribs?.build?.value ?? 0);
        const proneTarget = Boolean(defender?.statuses?.has?.("prone"));
        const smallTarget = Number.isFinite(build) && build <= -2;
        const largeTarget = Number.isFinite(build) && build >= 4;

        let inMelee = false;
        const resolvedTargetToken = targetToken ?? canvas?.tokens?.placeables?.find((t) => t.actor?.id === defender?.id) ?? null;
        if (resolvedTargetToken && canvas?.tokens?.placeables?.length) {
            inMelee = canvas.tokens.placeables.some((other) => {
                if (!other?.actor || other.id === resolvedTargetToken.id) return false;
                if (other.actor.id === attacker?.id) return false;
                if (other.document?.disposition !== resolvedTargetToken.document?.disposition) {
                    const d = this.measureTokenDistance(other, resolvedTargetToken);
                    return d !== null && d <= 2;
                }
                return false;
            });
        }

        return {
            distance,
            rangeTier,
            tacticalFlags: {
                pointBlank,
                aiming: false,
                cover: false,
                fastTarget: false,
                inMelee,
                proneTarget,
                smallTarget,
                largeTarget
            }
        };
    }

    /** Immediately deducts ammo from the weapon item. */
    static async consumeWeaponAmmo(weapon, amount = 1) {
        if (!weapon || amount <= 0) return null;
        const profile = this.getWeaponCombatProfile(weapon);
        if (!profile.tracksAmmo) return null;
        const nextAmmo = Math.max(0, profile.ammo - amount);
        const ammoPath = weapon.system?.data?.ammo !== undefined && weapon.system?.ammo === undefined
            ? "system.data.ammo" : "system.ammo";
        await weapon.update({ [ammoPath]: nextAmmo });
        return nextAmmo;
    }

    /** Immediately reloads the weapon item up to its magazine capacity. */
    static async reloadWeapon(weapon, amount = null) {
        if (!weapon) return null;
        const profile = this.getWeaponCombatProfile(weapon);
        if (!profile.tracksAmmo) return null;
        const targetAmmo = amount === null
            ? profile.ammoMax
            : Math.min(profile.ammoMax, profile.ammo + Math.max(1, Number(amount)));
        await weapon.update({ "system.ammo": targetAmmo });
        return targetAmmo;
    }

    /** Immediately updates the jammed/malfunction state on the weapon item. */
    static async setWeaponMalfunction(weapon, jammed) {
        if (!weapon) return;
        if (typeof weapon.setFlag === "function" && typeof weapon.unsetFlag === "function") {
            if (jammed) await weapon.setFlag(COC7_MODULE_ID, "jammed", true);
            else await weapon.unsetFlag(COC7_MODULE_ID, "jammed");
        }
    }
}
