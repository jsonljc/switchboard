import type { PrismaClient } from "@prisma/client";
import type { EntityMapping, EntityRef } from "@switchboard/schemas";
import type { EntityMappingStore } from "@switchboard/core";

export class PrismaEntityGraphStore implements EntityMappingStore {
  constructor(private prisma: PrismaClient) {}

  async save(mapping: EntityMapping): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Upsert the mapping
      await tx.entityMapping.upsert({
        where: { id: mapping.id },
        create: {
          id: mapping.id,
          organizationId: mapping.organizationId,
          label: mapping.label,
          createdBy: mapping.createdBy,
          createdAt: mapping.createdAt,
          updatedAt: mapping.updatedAt,
        },
        update: {
          label: mapping.label,
          updatedAt: mapping.updatedAt,
        },
      });

      // Delete existing refs, re-insert
      await tx.entityMappingRef.deleteMany({
        where: { mappingId: mapping.id },
      });

      if (mapping.refs.length > 0) {
        await tx.entityMappingRef.createMany({
          data: mapping.refs.map((ref) => ({
            mappingId: mapping.id,
            cartridgeId: ref.cartridgeId,
            entityType: ref.entityType,
            entityId: ref.entityId,
          })),
        });
      }
    });
  }

  async getById(id: string): Promise<EntityMapping | null> {
    const row = await this.prisma.entityMapping.findUnique({
      where: { id },
      include: { refs: true },
    });
    if (!row) return null;
    return toEntityMapping(row);
  }

  async findByRef(ref: EntityRef, organizationId: string): Promise<EntityMapping | null> {
    const refRow = await this.prisma.entityMappingRef.findFirst({
      where: {
        cartridgeId: ref.cartridgeId,
        entityType: ref.entityType,
        entityId: ref.entityId,
        mapping: { organizationId },
      },
      include: { mapping: { include: { refs: true } } },
    });
    if (!refRow) return null;
    return toEntityMapping(refRow.mapping);
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
    const rows = await this.prisma.entityMapping.findMany({
      where: { organizationId },
      include: { refs: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toEntityMapping);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.entityMappingRef.deleteMany({ where: { mappingId: id } });
        await tx.entityMapping.delete({ where: { id } });
      });
      return true;
    } catch {
      return false;
    }
  }

  async merge(id1: string, id2: string): Promise<EntityMapping> {
    return this.prisma.$transaction(async (tx) => {
      const m1 = await tx.entityMapping.findUnique({
        where: { id: id1 },
        include: { refs: true },
      });
      const m2 = await tx.entityMapping.findUnique({
        where: { id: id2 },
        include: { refs: true },
      });

      if (!m1) throw new Error(`EntityMapping not found: ${id1}`);
      if (!m2) throw new Error(`EntityMapping not found: ${id2}`);
      if (m1.organizationId !== m2.organizationId) {
        throw new Error("Cannot merge mappings from different organizations");
      }

      // Union merge refs, dedup by (cartridgeId, entityType, entityId)
      const seen = new Set<string>();
      const mergedRefs: EntityRef[] = [];
      const allRefs = [...m1.refs, ...m2.refs];
      for (const r of allRefs) {
        const key = `${r.cartridgeId}:${r.entityType}:${r.entityId}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedRefs.push({
            cartridgeId: r.cartridgeId,
            entityType: r.entityType,
            entityId: r.entityId,
          });
        }
      }

      // Delete m2 refs and m2
      await tx.entityMappingRef.deleteMany({ where: { mappingId: id2 } });
      await tx.entityMapping.delete({ where: { id: id2 } });

      // Delete m1 refs and re-insert merged
      await tx.entityMappingRef.deleteMany({ where: { mappingId: id1 } });
      if (mergedRefs.length > 0) {
        await tx.entityMappingRef.createMany({
          data: mergedRefs.map((ref) => ({
            mappingId: id1,
            cartridgeId: ref.cartridgeId,
            entityType: ref.entityType,
            entityId: ref.entityId,
          })),
        });
      }

      // Update the mapping
      const now = new Date();
      await tx.entityMapping.update({
        where: { id: id1 },
        data: {
          label: m1.label ?? m2.label,
          updatedAt: now,
        },
      });

      return {
        id: m1.id,
        organizationId: m1.organizationId,
        refs: mergedRefs,
        label: m1.label ?? m2.label,
        createdAt: m1.createdAt < m2.createdAt ? m1.createdAt : m2.createdAt,
        updatedAt: now,
        createdBy: m1.createdBy,
      };
    });
  }
}

function toEntityMapping(row: {
  id: string;
  organizationId: string;
  label: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  refs: Array<{ cartridgeId: string; entityType: string; entityId: string }>;
}): EntityMapping {
  return {
    id: row.id,
    organizationId: row.organizationId,
    refs: row.refs.map((r) => ({
      cartridgeId: r.cartridgeId,
      entityType: r.entityType,
      entityId: r.entityId,
    })),
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
  };
}
