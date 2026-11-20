/** Computes range zones, wall-clipped sight polygons, and scene measurements for ranged overlays. */
export class RangedOverlayGeometry {
    /** Computes the point-blank threshold in the active scene's grid units. */
    static getPointBlankDistance(attackerToken) {
        const dex = Number(attackerToken?.actor?.system?.characteristics?.dex?.value ?? 50);
        const pointBlankFeet = Math.max(1, Math.floor(dex / 5));
        return this.isFeetScene() ? pointBlankFeet : Math.round((pointBlankFeet / 3) * 10) / 10;
    }

    /** Computes the point-blank radius in canvas pixels. */
    static getPointBlankRadius(attackerToken) {
        const dex = Number(attackerToken?.actor?.system?.characteristics?.dex?.value ?? 50);
        const pointBlankFeet = Math.max(1, Math.floor(dex / 5));
        return (pointBlankFeet / 3) * this.getPixelsPerYard();
    }

    /** Builds ordered range band definitions for either shotguns or standard ranged weapons. */
    static buildRangeZones(session, attackerToken) {
        const profile = session.weaponProfile ?? {};
        const pxPerYard = this.getPixelsPerYard();
        const pbDist = this.getPointBlankDistance(attackerToken);
        const pbRadius = this.getPointBlankRadius(attackerToken);

        if (profile.isShotgun) {
            const baseDist = Math.max(1, Number(profile.baseRange || 10));
            const longDist = Math.max(baseDist + 1, Number(profile.longRange || baseDist * 2));
            const extremeDist = Math.max(longDist + 1, Number(profile.extremeRange || longDist * 2.5));
            return [
                { id: "shotgun-extreme", minDist: longDist, maxDist: extremeDist, radius: extremeDist * pxPerYard, color: 0xe63946 },
                { id: "shotgun-long", minDist: baseDist, maxDist: longDist, radius: longDist * pxPerYard, color: 0xf4a261 },
                { id: "shotgun-normal", minDist: 0, maxDist: baseDist, radius: baseDist * pxPerYard, color: 0x7ee2a8 },
                { id: "point-blank", minDist: 0, maxDist: pbDist, radius: pbRadius, color: 0x38bdf8 }
            ];
        }

        const baseRange = Math.max(0, Number(profile.baseRange ?? 0));
        const longRange = Math.max(0, Number(profile.longRange || baseRange * 2));
        const extremeRange = Math.max(0, Number(profile.extremeRange || longRange * 2));
        const zones = [];

        if (extremeRange > longRange) {
            zones.push({ id: "extreme", minDist: longRange, maxDist: extremeRange, radius: extremeRange * pxPerYard, color: 0xe63946 });
        }
        if (longRange > baseRange) {
            zones.push({ id: "long", minDist: baseRange, maxDist: longRange, radius: longRange * pxPerYard, color: 0xf4a261 });
        }
        if (baseRange > 0) {
            zones.push({ id: "normal", minDist: 0, maxDist: baseRange, radius: baseRange * pxPerYard, color: 0x7ee2a8 });
        }
        zones.push({ id: "point-blank", minDist: 0, maxDist: pbDist, radius: pbRadius, color: 0x38bdf8 });
        return zones;
    }

    /** Creates a wall-clipped sight polygon for the given origin and pixel radius, or null if unavailable. */
    static createWallClippedPolygon(origin, radius) {
        try {
            const backend = CONFIG?.Canvas?.polygonBackends?.sight;
            if (!backend?.create) return null;
            return backend.create({ x: origin.x, y: origin.y }, {
                type: "sight",
                radius,
                useThreshold: true
            });
        } catch {
            return null;
        }
    }

    /** Returns true when a world point lies inside the given sight polygon and is not blocked by walls. */
    static isPointVisibleFromOrigin(origin, point, outerPolygon) {
        if (outerPolygon && typeof outerPolygon.contains === "function") {
            return outerPolygon.contains(point.x, point.y);
        }
        const blocked = CONFIG?.Canvas?.polygonBackends?.sight?.testCollision?.(
            origin,
            point,
            { type: "sight", mode: "any" }
        );
        return !blocked;
    }

    /** Measures canvas distance between two world points in scene grid units. */
    static measureWorldDistance(pointA, pointB) {
        const gridSize = Number(canvas?.dimensions?.size ?? 100) || 100;
        const gridDistance = Number(canvas?.scene?.grid?.distance ?? 1) || 1;
        const pxDist = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
        return Math.round(((pxDist / gridSize) * gridDistance) * 10) / 10;
    }

    /** Returns the pixel-per-yard conversion factor for the active scene grid. */
    static getPixelsPerYard() {
        const gridSize = Number(canvas?.dimensions?.size ?? 100);
        const gridDistance = Number(canvas?.scene?.grid?.distance ?? 1) || 1;
        return (gridSize / gridDistance) * (this.isFeetScene() ? 3 : 1);
    }

    /** Returns the display unit label configured on the active scene. */
    static getUnitSuffix() {
        return String(canvas?.scene?.grid?.units ?? "").trim() || "m";
    }

    /** Returns true when the active scene measures distances in feet. */
    static isFeetScene() {
        const units = String(canvas?.scene?.grid?.units ?? "").trim().toLowerCase();
        return ["ft", "feet", "foot", "fuss", "fuß"].includes(units);
    }
}
