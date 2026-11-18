import { SessionStore } from "../../core-bridge.mjs";

/** Normalizes ranged damage entries stored under actor IDs or expanded Foundry UUID paths. */
export class RangedDamageState {
    /** Encodes an actor reference so Foundry does not treat its dots as property paths. */
    static storageKey(reference) {
        return encodeURIComponent(reference).replace(/\./g, "%2E");
    }

    /** Returns distinct target entries, including entries from older expanded session flags. */
    static entries(damageByActor) {
        const found = [];
        this.#collect(damageByActor ?? {}, [], found);
        const distinct = new Map();
        for (const entry of found) {
            const identity = entry.actorUuid || `id:${entry.actorId || entry.key}`;
            const previous = distinct.get(identity);
            if (!previous || entry.isCurrentKey) distinct.set(identity, entry);
        }
        return this.#removeSupersededIdEntries(Array.from(distinct.values()));
    }

    /** Combines historical and new per-target damage without retaining old previews. */
    static merge(previous, current) {
        const merged = {};
        for (const entry of this.entries(previous)) {
            const { preview, ...info } = entry.info;
            merged[this.storageKey(entry.actorUuid || entry.actorId)] = info;
        }
        for (const entry of this.entries(current)) this.#mergeEntry(merged, entry);
        return merged;
    }

    static #mergeEntry(merged, entry) {
        const key = this.storageKey(entry.actorUuid || entry.actorId);
        const previous = merged[key];
        merged[key] = previous ? {
            ...entry.info,
            damage: Number(previous.damage) + Number(entry.info.damage),
            majorWound: Boolean(previous.majorWound || entry.info.majorWound),
            fatalHit: Boolean(previous.fatalHit || entry.info.fatalHit)
        } : entry.info;
    }

    /** Matches a damage entry to its recorded hit without conflating distinct token actors. */
    static matchesHit(entry, hit) {
        if (entry.actorUuid && hit.targetActorUuid) return entry.actorUuid === hit.targetActorUuid;
        return Boolean(entry.actorId && entry.actorId === hit.targetActorId);
    }

    /** Resolves the exact UUID when available, without falling back to a different token actor. */
    static resolveActor({ actorUuid, actorId }) {
        return SessionStore.resolveActor({ actorUuid, actorId: actorUuid ? "" : actorId });
    }

    static #collect(node, path, entries) {
        if (!node || typeof node !== "object" || Array.isArray(node)) {
            entries.push(this.#buildEntry(path, {}));
            return;
        }
        if (Object.prototype.hasOwnProperty.call(node, "damage")) {
            entries.push(this.#buildEntry(path, node));
            return;
        }
        const children = Object.entries(node);
        if (!children.length && path.length) entries.push(this.#buildEntry(path, node));
        for (const [key, value] of children) this.#collect(value, [...path, key], entries);
    }

    static #buildEntry(path, info) {
        const key = path.join(".");
        const inferredUuid = /^(Actor|Scene|Compendium)\./.test(key) ? key : "";
        const actorUuid = info.actorUuid || inferredUuid;
        const actorId = info.actorId || (!actorUuid ? key : "");
        return {
            key, info, actorUuid, actorId,
            isCurrentKey: Boolean(actorUuid && path.length === 1 && key === this.storageKey(actorUuid))
        };
    }

    static #removeSupersededIdEntries(entries) {
        return entries.filter((entry) => !this.#isSupersededWorldActorEntry(entry, entries));
    }

    static #isSupersededWorldActorEntry(entry, entries) {
        if (entry.actorUuid || !entry.actorId) return false;
        return entries.some((candidate) => candidate.actorUuid === `Actor.${entry.actorId}`);
    }
}
