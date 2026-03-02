import type { EntityMapping, EntityRef } from "./types.js";

export interface EntityMappingStore {
  save(mapping: EntityMapping): Promise<void>;
  getById(id: string): Promise<EntityMapping | null>;
  findByRef(ref: EntityRef, organizationId: string): Promise<EntityMapping | null>;
  resolve(
    source: EntityRef,
    targetCartridgeId: string,
    targetEntityType: string,
    organizationId: string,
  ): Promise<EntityRef | null>;
  list(organizationId: string): Promise<EntityMapping[]>;
  delete(id: string): Promise<boolean>;
  merge(id1: string, id2: string): Promise<EntityMapping>;
}
