import { RangedCombatRules } from "./ranged-combat-rules.mjs";
import { RangedOverlayGeometry } from "./ranged-overlay-geometry.mjs";
import { RangedCursorHud } from "./ranged-cursor-hud.mjs";

const ACTIVE_PHASES = new Set(["aimChoice", "aiming", "reaction", "attack"]);

/** Coordinates the Alt-toggled tactical canvas overlay for the focused ranged prompt. */
export class RangedTacticalOverlay {
    static #container = null;
    static #focusedMessageId = null;
    static #focusedSession = null;
    static #previewTargetId = null;
    static #altHeld = false;
    static #listenersBound = false;
    static #mouseScreen = null;
    static #cursorHud = null;
    static #outerSightPolygon = null;
    static #zoneLayers = [];

    /** Marks a ranged prompt as focused and redraws its tactical canvas overlay. */
    static focus(messageId, session, previewTargetId = null) {
        if (!messageId || !canvas?.ready || !canvas?.controls) return;
        this.#bindListeners();
        this.#focusedMessageId = messageId;
        this.#focusedSession = session;
        if (previewTargetId !== null) this.#previewTargetId = previewTargetId;
        this.sync(messageId, session);
    }

    /** Redraws range zones, lines of fire, and the cursor HUD when the focused session updates. */
    static sync(messageId, session) {
        if (!messageId || !canvas?.ready || !canvas?.controls) return;
        if (this.#focusedMessageId && this.#focusedMessageId !== messageId) return;

        if (!session || session.isResolved || !ACTIVE_PHASES.has(session.combatPhase)) {
            this.clear(messageId);
            return;
        }

        this.#focusedMessageId = messageId;
        this.#focusedSession = session;

        const attackerToken = this.#resolveAttackerToken(session);
        const primaryTarget = this.#resolveTargetToken(session, this.#previewTargetId || session.rangedTargetTokenId);
        if (!primaryTarget?.center) {
            this.clear(messageId);
            return;
        }

        const container = this.#resetContainer();
        this.#zoneLayers = [];

        const zones = RangedOverlayGeometry.buildRangeZones(session, attackerToken);
        this.#renderZoneLayers(container, attackerToken, zones);

        const overlayGfx = new PIXI.Graphics();
        container.addChild(overlayGfx);
        this.#drawLineOfFire(overlayGfx, attackerToken, primaryTarget, session.rangedRangeTier || "normal");
        this.#drawShotgunSpreadTargets(overlayGfx, session, primaryTarget);
        this.#drawAutoTraverse(overlayGfx, session, primaryTarget);

        const maxRadius = zones.reduce((max, zone) => Math.max(max, zone.radius), 0);
        this.#outerSightPolygon = attackerToken?.center && maxRadius > 0
            ? RangedOverlayGeometry.createWallClippedPolygon(attackerToken.center, maxRadius)
            : null;
        this.#cursorHud = attackerToken?.center && typeof PIXI?.Text === "function"
            ? new RangedCursorHud(container)
            : null;

        this.#refreshCursorState(attackerToken);
        container.visible = this.#altHeld;
    }

    /** Destroys the canvas overlay when the owning prompt closes or resolves. */
    static clear(messageId) {
        if (messageId && this.#focusedMessageId && this.#focusedMessageId !== messageId) return;
        this.#focusedMessageId = null;
        this.#focusedSession = null;
        this.#previewTargetId = null;
        this.#cursorHud = null;
        this.#outerSightPolygon = null;
        this.#zoneLayers = [];
        if (this.#container && !this.#container.destroyed) {
            this.#container.destroy({ children: true });
        }
        this.#container = null;
    }
    static #bindListeners() {
        if (this.#listenersBound || typeof window === "undefined") return;
        this.#listenersBound = true;

        window.addEventListener("pointermove", (ev) => this.#onPointerMove(ev), { passive: true });
        window.addEventListener("keydown", (ev) => this.#onKeyChange(ev, true), { capture: true });
        window.addEventListener("keyup", (ev) => this.#onKeyChange(ev, false), { capture: true });
        window.addEventListener("blur", () => this.#setAltHeld(false));
        Hooks.on("canvasPan", () => this.#onCanvasPan());
    }

    static #onPointerMove(ev) {
        this.#mouseScreen = { x: ev.clientX, y: ev.clientY };
        if (this.#altHeld && this.#container?.visible && this.#focusedSession) {
            this.#refreshCursorState(this.#resolveAttackerToken(this.#focusedSession));
        }
    }

    static #onKeyChange(ev, isDown) {
        if (ev.key === "Alt" || ev.altKey === isDown) {
            this.#setAltHeld(isDown ? true : Boolean(ev.altKey));
        }
    }

    static #onCanvasPan() {
        if (this.#altHeld && this.#focusedMessageId && this.#focusedSession) {
            this.#refreshCursorState(this.#resolveAttackerToken(this.#focusedSession));
        }
    }

    static #setAltHeld(held) {
        if (this.#altHeld === held) return;
        this.#altHeld = held;
        if (held && this.#focusedMessageId && this.#focusedSession) {
            this.sync(this.#focusedMessageId, this.#focusedSession);
            return;
        }
        if (this.#container && !this.#container.destroyed) {
            this.#container.visible = held;
        }
    }

    static #refreshCursorState(attackerToken) {
        const distance = this.#cursorHud?.update({
            session: this.#focusedSession,
            attackerToken,
            mouseScreen: this.#mouseScreen,
            outerPolygon: this.#outerSightPolygon
        }) ?? null;

        const inPointBlank = distance !== null && this.#zoneLayers.some((z) => z.id === "point-blank" && distance <= z.maxDist);
        for (const zone of this.#zoneLayers) {
            const isMatched = distance !== null && (zone.id === "point-blank"
                ? inPointBlank
                : (!inPointBlank && distance > zone.minDist && distance <= zone.maxDist));
            zone.layer.alpha = isMatched ? 1.0 : 0.22;
        }
    }

    static #renderZoneLayers(container, attackerToken, zones) {
        if (!attackerToken?.center) return;
        for (const zone of zones) {
            const layer = new PIXI.Graphics();
            this.#drawPolygonOrCircle(layer, attackerToken.center, zone.radius, zone.color, 0.22, 0.9);
            layer.alpha = 0.22;
            container.addChild(layer);
            this.#zoneLayers.push({ ...zone, layer });
        }
    }

    static #drawLineOfFire(gfx, attackerToken, primaryTarget, tier) {
        if (!attackerToken?.center) return;
        const lineColor = tier === "extreme" ? 0xe63946 : tier === "long" ? 0xf4a261 : 0x7ee2a8;
        gfx.lineStyle(2, lineColor, 0.65);
        gfx.moveTo(attackerToken.center.x, attackerToken.center.y);
        gfx.lineTo(primaryTarget.center.x, primaryTarget.center.y);
    }

    static #drawShotgunSpreadTargets(gfx, session, primaryTarget) {
        const profile = session.weaponProfile;
        if (!profile?.isShotgun) return;
        const spreadTargets = RangedCombatRules.resolveShotgunSpreadTargets(
            { ...session, rangedTargetTokenId: primaryTarget.id, rangedShotgunBand: session.rangedShotgunBand || "normal" },
            profile,
            { actorId: primaryTarget.actor?.id }
        );
        for (const hit of spreadTargets) {
            const token = canvas?.tokens?.placeables?.find((t) => t.id === hit.targetKey);
            if (!token?.center) continue;
            const ringRadius = Math.max(24, Math.round(Math.max(token.w ?? 50, token.h ?? 50) * 0.55));
            this.#drawPolygonOrCircle(gfx, token.center, ringRadius, 0xe07a5f, 0.2, 0.95);
        }
    }

    static #drawAutoTraverse(gfx, session, primaryTarget) {
        if (session.rangedFireMode !== "auto" || Number(session.rangedShotsFired ?? 0) <= 0) return;
        const anchorToken = this.#resolveTargetToken(session, session.lastVolleyTargetTokenId || session.rangedTargetTokenId);
        if (!anchorToken?.center) return;

        const pxPerYard = RangedOverlayGeometry.getPixelsPerYard();
        this.#drawPolygonOrCircle(gfx, anchorToken.center, 3 * pxPerYard, 0xf4a261, 0.08, 0.55);
        this.#drawPolygonOrCircle(gfx, anchorToken.center, 6 * pxPerYard, 0xe63946, 0.06, 0.5);

        if (anchorToken.id !== primaryTarget.id) {
            gfx.lineStyle(2.5, 0xf4a261, 0.85);
            gfx.moveTo(anchorToken.center.x, anchorToken.center.y);
            gfx.lineTo(primaryTarget.center.x, primaryTarget.center.y);
        }
    }

    static #drawPolygonOrCircle(gfx, center, radius, color, fillAlpha, strokeAlpha) {
        gfx.lineStyle(2, color, strokeAlpha);
        gfx.beginFill(color, fillAlpha);
        const poly = RangedOverlayGeometry.createWallClippedPolygon(center, radius);
        if (poly) gfx.drawPolygon(poly);
        else gfx.drawCircle(center.x, center.y, radius);
        gfx.endFill();
    }

    static #resetContainer() {
        if (this.#container && !this.#container.destroyed) {
            this.#container.destroy({ children: true });
        }
        this.#container = new PIXI.Container();
        this.#container.visible = this.#altHeld;
        canvas.controls.addChild(this.#container);
        return this.#container;
    }

    static #resolveAttackerToken(session) {
        const attacker = session.participants?.find((p) => p.key === "attacker");
        return attacker ? canvas?.tokens?.placeables?.find((t) => t.actor?.id === attacker.actorId) ?? null : null;
    }

    static #resolveTargetToken(session, tokenId) {
        const tokens = canvas?.tokens?.placeables ?? [];
        if (tokenId) {
            const byId = tokens.find((t) => t.id === tokenId);
            if (byId) return byId;
        }
        const defender = session.participants?.find((p) => p.key === "defender");
        return defender ? tokens.find((t) => t.actor?.id === defender.actorId) ?? null : null;
    }
}
