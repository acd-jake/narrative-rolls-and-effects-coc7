import { RangedCombatRules } from "./ranged-combat-rules.mjs";
import { RangedOverlayGeometry } from "./ranged-overlay-geometry.mjs";

/** Manages the floating cursor distance and range-zone badge inside the tactical overlay. */
export class RangedCursorHud {
    #bg;
    #label;

    /** Creates the PIXI graphics and text elements attached to the given parent container. */
    constructor(parentContainer) {
        this.#bg = new PIXI.Graphics();
        this.#label = new PIXI.Text("", {
            fontFamily: "Signika, sans-serif",
            fontSize: 16,
            fontWeight: "bold",
            fill: 0xf4efe6,
            stroke: 0x0a0b0e,
            strokeThickness: 3.5
        });
        this.#label.anchor.set(0.5, 0.5);
        parentContainer.addChild(this.#bg);
        parentContainer.addChild(this.#label);
    }

    /** Hides the badge and clears its background frame. */
    hide() {
        if (!this.#label.destroyed) this.#label.visible = false;
        if (!this.#bg.destroyed) this.#bg.clear();
    }

    /** Updates badge text, border color, and viewport-clamped position for the current cursor state. */
    update({ session, attackerToken, mouseScreen, outerPolygon }) {
        if (this.#label.destroyed || this.#bg.destroyed) return null;
        const wt = canvas?.stage?.worldTransform;
        if (!wt || !mouseScreen || !attackerToken?.center) {
            this.hide();
            return null;
        }

        const mouseWorld = wt.applyInverse(new PIXI.Point(mouseScreen.x, mouseScreen.y));
        if (!RangedOverlayGeometry.isPointVisibleFromOrigin(attackerToken.center, mouseWorld, outerPolygon)) {
            this.hide();
            return null;
        }

        const unitLabel = RangedOverlayGeometry.getUnitSuffix();
        const distance = RangedOverlayGeometry.measureWorldDistance(attackerToken.center, mouseWorld);
        const zone = this.#describeRangeZone(session, attackerToken, distance, unitLabel);

        this.#label.visible = true;
        this.#label.text = game.i18n.format("ROE_COC7.Ranged.Overlay.CursorDistance", {
            distance: `${this.#formatNumber(distance)} ${unitLabel}`,
            zone: zone.text
        });

        this.#drawAtClampedPosition(wt, mouseScreen, zone.color);
        return distance;
    }

    #drawAtClampedPosition(wt, mouseScreen, borderColor) {
        const boxW = this.#label.width + 18;
        const boxH = this.#label.height + 10;
        const scaleX = Math.hypot(wt.a, wt.b) || 1;
        const scaleY = Math.hypot(wt.c, wt.d) || 1;
        const halfW = (boxW * scaleX) / 2;
        const halfH = (boxH * scaleY) / 2;

        const sidebarRect = document.getElementById("sidebar")?.getBoundingClientRect();
        const hotbarRect = document.getElementById("hotbar")?.getBoundingClientRect();
        const margin = 12;

        const minX = margin + halfW;
        const maxX = Math.max(minX, (sidebarRect && sidebarRect.width > 0 ? sidebarRect.left : window.innerWidth) - margin - halfW);
        const minY = margin + halfH;
        const maxY = Math.max(minY, (hotbarRect && hotbarRect.height > 0 ? hotbarRect.top : window.innerHeight) - margin - halfH);

        const clamped = new PIXI.Point(
            Math.min(Math.max(minX, mouseScreen.x), maxX),
            Math.min(Math.max(minY, mouseScreen.y - halfH - 18), maxY)
        );
        const pos = wt.applyInverse(clamped);

        this.#label.position.set(pos.x, pos.y);
        this.#bg.clear();
        this.#bg.lineStyle(1.5, borderColor, 0.95);
        this.#bg.beginFill(0x0c0e12, 0.92);
        this.#bg.drawRoundedRect(pos.x - boxW / 2, pos.y - boxH / 2, boxW, boxH, 4);
        this.#bg.endFill();
    }
    #describeRangeZone(session, attackerToken, distance, unitLabel) {
        const profile = session.weaponProfile ?? {};
        const pointBlankDist = RangedOverlayGeometry.getPointBlankDistance(attackerToken);
        const isPointBlank = distance <= pointBlankDist;

        if (profile.isShotgun) {
            return this.#describeShotgunZone(session, profile, distance, pointBlankDist, isPointBlank, unitLabel);
        }

        if (isPointBlank) {
            return {
                color: 0x38bdf8,
                text: game.i18n.format("ROE_COC7.Ranged.Overlay.ZonePointBlank", { max: `${this.#formatNumber(pointBlankDist)} ${unitLabel}` })
            };
        }

        const baseRange = Math.max(0, Number(profile.baseRange ?? 0));
        const longRange = Math.max(0, Number(profile.longRange || baseRange * 2));
        const extremeRange = Math.max(0, Number(profile.extremeRange || longRange * 2));

        if (!baseRange || distance <= baseRange) {
            return {
                color: 0x7ee2a8,
                text: baseRange
                    ? game.i18n.format("ROE_COC7.Ranged.Overlay.ZoneNormalRange", { max: `${baseRange} ${unitLabel}` })
                    : game.i18n.localize("ROE_COC7.Ranged.Ranges.Normal")
            };
        }
        if (distance <= longRange) {
            return { color: 0xf4a261, text: game.i18n.format("ROE_COC7.Ranged.Overlay.ZoneLongRange", { max: `${longRange} ${unitLabel}` }) };
        }
        if (!extremeRange || distance <= extremeRange) {
            return {
                color: 0xe63946,
                text: extremeRange
                    ? game.i18n.format("ROE_COC7.Ranged.Overlay.ZoneExtremeRange", { max: `${extremeRange} ${unitLabel}` })
                    : game.i18n.localize("ROE_COC7.Ranged.Ranges.Extreme")
            };
        }
        return { color: 0x9ca3af, text: game.i18n.localize("ROE_COC7.Ranged.Overlay.ZoneOutOfRange") };
    }

    #describeShotgunZone(session, profile, distance, pointBlankDist, isPointBlank, unitLabel) {
        const baseDist = Math.max(1, Number(profile.baseRange || 10));
        const longDist = Math.max(baseDist + 1, Number(profile.longRange || baseDist * 2));
        const extremeDist = Math.max(longDist + 1, Number(profile.extremeRange || longDist * 2.5));

        if (distance <= baseDist) {
            const dmg = RangedCombatRules.resolveRangeDamageFormula({ ...session, rangedShotgunBand: "normal" }, profile);
            const baseText = game.i18n.format("ROE_COC7.Ranged.Overlay.ZoneShotgunNormal", { max: `${baseDist} ${unitLabel}`, damage: dmg });
            if (!isPointBlank) return { color: 0x7ee2a8, text: baseText };
            const pbText = game.i18n.format("ROE_COC7.Ranged.Overlay.ZonePointBlank", { max: `${this.#formatNumber(pointBlankDist)} ${unitLabel}` });
            return { color: 0x38bdf8, text: `${pbText} • ${baseText}` };
        }
        if (distance <= longDist) {
            const dmg = RangedCombatRules.resolveRangeDamageFormula({ ...session, rangedShotgunBand: "long" }, profile);
            return { color: 0xf4a261, text: game.i18n.format("ROE_COC7.Ranged.Overlay.ZoneShotgunLong", { max: `${longDist} ${unitLabel}`, damage: dmg }) };
        }
        if (distance <= extremeDist) {
            const dmg = RangedCombatRules.resolveRangeDamageFormula({ ...session, rangedShotgunBand: "extreme" }, profile);
            return { color: 0xe63946, text: game.i18n.format("ROE_COC7.Ranged.Overlay.ZoneShotgunExtreme", { max: `${extremeDist} ${unitLabel}`, damage: dmg }) };
        }
        return { color: 0x9ca3af, text: game.i18n.localize("ROE_COC7.Ranged.Overlay.ZoneOutOfRange") };
    }

    #formatNumber(value) {
        const lang = game.i18n?.lang === "de" ? "de-DE" : "en-US";
        return Number(value ?? 0).toLocaleString(lang, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    }
}
