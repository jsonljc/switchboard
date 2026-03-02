import { randomUUID } from "node:crypto";
import type { EntityRef, EntityMapping, CrossCartridgeEntityResolution } from "./types.js";
import type { EntityMappingStore } from "./store.js";

export class EntityGraphService {
  constructor(private store: EntityMappingStore) {}

  /**
   * Resolve all known cross-cartridge refs for a given entity.
   */
  async resolve(ref: EntityRef, organizationId: string): Promise<CrossCartridgeEntityResolution> {
    const mapping = await this.store.findByRef(ref, organizationId);
    const resolved: Record<string, EntityRef> = {};
    if (mapping) {
      for (const r of mapping.refs) {
        resolved[`${r.cartridgeId}.${r.entityType}`] = r;
      }
    }
    return {
      query: ref,
      mapping,
      resolved,
    };
  }

  /**
   * Shorthand: resolve source entity to a specific target cartridge + type.
   * Returns the entityId or null if no mapping exists.
   */
  async resolveToCartridge(
    source: EntityRef,
    targetCartridgeId: string,
    targetEntityType: string,
    organizationId: string,
  ): Promise<string | null> {
    const target = await this.store.resolve(source, targetCartridgeId, targetEntityType, organizationId);
    return target?.entityId ?? null;
  }

  /**
   * Create or merge an entity mapping. Idempotent — if any ref overlaps
   * an existing mapping, union-merges them.
   */
  async link(
    refs: EntityRef[],
    organizationId: string,
    createdBy: string,
    label?: string | null,
  ): Promise<EntityMapping> {
    if (refs.length < 2) {
      throw new Error("Entity mapping requires at least 2 refs");
    }

    // Check cartridge uniqueness in input — different cartridges required
    const cartridgeIds = new Set(refs.map((r) => r.cartridgeId));
    if (cartridgeIds.size < 2) {
      throw new Error("Entity mapping refs must span at least 2 different cartridges");
    }

    // Find existing mappings that overlap with any of the provided refs
    const existingMappings = new Map<string, EntityMapping>();
    for (const ref of refs) {
      const existing = await this.store.findByRef(ref, organizationId);
      if (existing) {
        existingMappings.set(existing.id, existing);
      }
    }

    const existingList = [...existingMappings.values()];

    if (existingList.length === 0) {
      // No overlap — create new mapping
      const mapping: EntityMapping = {
        id: `emap_${randomUUID()}`,
        organizationId,
        refs,
        label: label ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy,
      };
      await this.store.save(mapping);
      return mapping;
    }

    if (existingList.length === 1) {
      // One existing mapping — merge new refs into it
      const existing = existingList[0]!;
      const refKey = (r: EntityRef) => `${r.cartridgeId}:${r.entityType}:${r.entityId}`;
      const existingKeys = new Set(existing.refs.map(refKey));
      const newRefs = refs.filter((r) => !existingKeys.has(refKey(r)));
      if (newRefs.length === 0) {
        return existing; // Already fully linked
      }
      const updated: EntityMapping = {
        ...existing,
        refs: [...existing.refs, ...newRefs],
        updatedAt: new Date(),
      };
      await this.store.save(updated);
      return updated;
    }

    // Multiple existing mappings — merge them all together
    let base = existingList[0]!;
    for (let i = 1; i < existingList.length; i++) {
      base = await this.store.merge(base.id, existingList[i]!.id);
    }

    // Now add any new refs not yet in the merged mapping
    const refKey = (r: EntityRef) => `${r.cartridgeId}:${r.entityType}:${r.entityId}`;
    const mergedKeys = new Set(base.refs.map(refKey));
    const extraRefs = refs.filter((r) => !mergedKeys.has(refKey(r)));
    if (extraRefs.length > 0) {
      base = {
        ...base,
        refs: [...base.refs, ...extraRefs],
        updatedAt: new Date(),
      };
      await this.store.save(base);
    }

    return base;
  }

  /**
   * Remove a specific ref from its mapping. If the mapping drops below
   * 2 refs, delete it entirely.
   */
  async unlink(ref: EntityRef, organizationId: string): Promise<boolean> {
    const mapping = await this.store.findByRef(ref, organizationId);
    if (!mapping) return false;

    const refKey = (r: EntityRef) => `${r.cartridgeId}:${r.entityType}:${r.entityId}`;
    const targetKey = refKey(ref);
    const remaining = mapping.refs.filter((r) => refKey(r) !== targetKey);

    if (remaining.length < 2) {
      await this.store.delete(mapping.id);
    } else {
      await this.store.save({
        ...mapping,
        refs: remaining,
        updatedAt: new Date(),
      });
    }

    return true;
  }
}
