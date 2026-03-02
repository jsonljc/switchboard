import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryEntityMappingStore } from "../entity-graph/in-memory.js";
import { EntityGraphService } from "../entity-graph/service.js";
import type { EntityRef, EntityMapping } from "../entity-graph/types.js";

describe("InMemoryEntityMappingStore", () => {
  let store: InMemoryEntityMappingStore;

  beforeEach(() => {
    store = new InMemoryEntityMappingStore();
  });

  it("saves and retrieves a mapping by ID", async () => {
    const mapping: EntityMapping = {
      id: "emap_1",
      organizationId: "org_1",
      refs: [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      label: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    };
    await store.save(mapping);
    const result = await store.getById("emap_1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("emap_1");
    expect(result!.refs).toHaveLength(2);
  });

  it("findByRef finds mapping matching a ref", async () => {
    const mapping: EntityMapping = {
      id: "emap_1",
      organizationId: "org_1",
      refs: [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    };
    await store.save(mapping);

    const found = await store.findByRef(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "org_1",
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe("emap_1");

    const notFound = await store.findByRef(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "org_other",
    );
    expect(notFound).toBeNull();
  });

  it("resolve returns target ref from source", async () => {
    const mapping: EntityMapping = {
      id: "emap_1",
      organizationId: "org_1",
      refs: [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    };
    await store.save(mapping);

    const target = await store.resolve(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "payments",
      "customer",
      "org_1",
    );
    expect(target).not.toBeNull();
    expect(target!.entityId).toBe("cus_1");
  });

  it("merge unions two mappings", async () => {
    await store.save({
      id: "emap_1",
      organizationId: "org_1",
      refs: [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    });
    await store.save({
      id: "emap_2",
      organizationId: "org_1",
      refs: [
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
        { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_1" },
      ],
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    });

    const merged = await store.merge("emap_1", "emap_2");
    expect(merged.refs).toHaveLength(3);
    expect(merged.id).toBe("emap_1");

    // emap_2 should be deleted
    const gone = await store.getById("emap_2");
    expect(gone).toBeNull();
  });

  it("list filters by organizationId", async () => {
    await store.save({
      id: "emap_1",
      organizationId: "org_1",
      refs: [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    });
    await store.save({
      id: "emap_2",
      organizationId: "org_2",
      refs: [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_2" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_2" },
      ],
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    });

    const org1 = await store.list("org_1");
    expect(org1).toHaveLength(1);
    expect(org1[0]!.id).toBe("emap_1");
  });
});

describe("EntityGraphService", () => {
  let store: InMemoryEntityMappingStore;
  let service: EntityGraphService;

  beforeEach(() => {
    store = new InMemoryEntityMappingStore();
    service = new EntityGraphService(store);
  });

  it("link creates a new mapping when none overlap", async () => {
    const mapping = await service.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );
    expect(mapping.id).toMatch(/^emap_/);
    expect(mapping.refs).toHaveLength(2);
    expect(mapping.organizationId).toBe("org_1");
  });

  it("link merges into existing mapping when overlapping", async () => {
    await service.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    // Link a third cartridge that overlaps with payments
    const updated = await service.link(
      [
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
        { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_1" },
      ],
      "org_1",
      "admin",
    );

    expect(updated.refs).toHaveLength(3);
  });

  it("link is idempotent for identical refs", async () => {
    const refs: EntityRef[] = [
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
    ];
    const m1 = await service.link(refs, "org_1", "admin");
    const m2 = await service.link(refs, "org_1", "admin");
    expect(m1.id).toBe(m2.id);
    expect(m2.refs).toHaveLength(2);
  });

  it("link rejects refs from same cartridge only", async () => {
    await expect(
      service.link(
        [
          { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
          { cartridgeId: "crm", entityType: "contact", entityId: "ct_2" },
        ],
        "org_1",
        "admin",
      ),
    ).rejects.toThrow("at least 2 different cartridges");
  });

  it("link rejects fewer than 2 refs", async () => {
    await expect(
      service.link(
        [{ cartridgeId: "crm", entityType: "contact", entityId: "ct_1" }],
        "org_1",
        "admin",
      ),
    ).rejects.toThrow("at least 2 refs");
  });

  it("resolve returns all cross-cartridge refs", async () => {
    await service.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
        { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_1" },
      ],
      "org_1",
      "admin",
    );

    const resolution = await service.resolve(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "org_1",
    );

    expect(resolution.mapping).not.toBeNull();
    expect(Object.keys(resolution.resolved)).toHaveLength(3);
    expect(resolution.resolved["payments.customer"]?.entityId).toBe("cus_1");
    expect(resolution.resolved["patient-engagement.patient"]?.entityId).toBe("pat_1");
  });

  it("resolveToCartridge returns entityId shorthand", async () => {
    await service.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    const id = await service.resolveToCartridge(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "payments",
      "customer",
      "org_1",
    );
    expect(id).toBe("cus_1");
  });

  it("resolveToCartridge returns null for unknown mapping", async () => {
    const id = await service.resolveToCartridge(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_none" },
      "payments",
      "customer",
      "org_1",
    );
    expect(id).toBeNull();
  });

  it("unlink removes a ref and deletes mapping if below 2", async () => {
    await service.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    const removed = await service.unlink(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "org_1",
    );
    expect(removed).toBe(true);

    // Mapping should be deleted (only 1 ref remaining)
    const result = await service.resolve(
      { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      "org_1",
    );
    expect(result.mapping).toBeNull();
  });

  it("unlink keeps mapping with 3+ refs when removing one", async () => {
    await service.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
        { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_1" },
      ],
      "org_1",
      "admin",
    );

    await service.unlink(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "org_1",
    );

    // Mapping should still exist with 2 refs
    const result = await service.resolve(
      { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      "org_1",
    );
    expect(result.mapping).not.toBeNull();
    expect(result.mapping!.refs).toHaveLength(2);
  });

  it("unlink returns false for non-existent ref", async () => {
    const removed = await service.unlink(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_none" },
      "org_1",
    );
    expect(removed).toBe(false);
  });
});
