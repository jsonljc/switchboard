import type { EntityMapping, EntityRef } from "./types.js";
import type { EntityMappingStore } from "./store.js";

export class InMemoryEntityMappingStore implements EntityMappingStore {
  private store = new Map<string, EntityMapping>();

  async save(mapping: EntityMapping): Promise<void> {
    this.store.set(mapping.id, { ...mapping, refs: [...mapping.refs] });
  }

  async getById(id: string): Promise<EntityMapping | null> {
    const m = this.store.get(id);
    return m ? { ...m, refs: [...m.refs] } : null;
  }

  async findByRef(ref: EntityRef, organizationId: string): Promise<EntityMapping | null> {
    for (const mapping of this.store.values()) {
      if (mapping.organizationId !== organizationId) continue;
      const match = mapping.refs.some(
        (r) =>
          r.cartridgeId === ref.cartridgeId &&
          r.entityType === ref.entityType &&
          r.entityId === ref.entityId,
      );
      if (match) return { ...mapping, refs: [...mapping.refs] };
    }
    return null;
  }

  async resolve(
    source: EntityRef,
    targetCartridgeId: string,
    targetEntityType: string,
    organizationId: string,
  ): Promise<EntityRef | null> {
    const mapping = await this.findByRef(source, organizationId);
    if (!mapping) return null;
    const target = mapping.refs.find(
      (r) => r.cartridgeId === targetCartridgeId && r.entityType === targetEntityType,
    );
    return target ? { ...target } : null;
  }

  async list(organizationId: string): Promise<EntityMapping[]> {
    return [...this.store.values()]
      .filter((m) => m.organizationId === organizationId)
      .map((m) => ({ ...m, refs: [...m.refs] }));
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async merge(id1: string, id2: string): Promise<EntityMapping> {
    const m1 = this.store.get(id1);
    const m2 = this.store.get(id2);
    if (!m1) throw new Error(`EntityMapping not found: ${id1}`);
    if (!m2) throw new Error(`EntityMapping not found: ${id2}`);
    if (m1.organizationId !== m2.organizationId) {
      throw new Error("Cannot merge mappings from different organizations");
    }

    // Union merge: combine refs, dedup by (cartridgeId, entityType, entityId)
    const refKey = (r: EntityRef) => `${r.cartridgeId}:${r.entityType}:${r.entityId}`;
    const seen = new Set<string>();
    const mergedRefs: EntityRef[] = [];
    for (const r of [...m1.refs, ...m2.refs]) {
      const key = refKey(r);
      if (!seen.has(key)) {
        seen.add(key);
        mergedRefs.push(r);
      }
    }

    const merged: EntityMapping = {
      id: m1.id,
      organizationId: m1.organizationId,
      refs: mergedRefs,
      label: m1.label ?? m2.label,
      createdAt: m1.createdAt < m2.createdAt ? m1.createdAt : m2.createdAt,
      updatedAt: new Date(),
      createdBy: m1.createdBy,
    };

    this.store.set(m1.id, merged);
    this.store.delete(id2);

    return { ...merged, refs: [...merged.refs] };
  }
}
