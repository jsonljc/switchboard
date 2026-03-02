import { describe, it, expect, beforeEach, vi } from "vitest";
import { DefaultCrossCartridgeEnricher } from "../enrichment/enricher.js";
import { EntityGraphService } from "../entity-graph/service.js";
import { InMemoryEntityMappingStore } from "../entity-graph/in-memory.js";
import type { CartridgeRegistry } from "../storage/interfaces.js";
import type { Cartridge } from "@switchboard/cartridge-sdk";
import type { EnrichmentMapping } from "../enrichment/types.js";

function createMockCartridge(enrichData: Record<string, unknown> = {}): Cartridge {
  return {
    manifest: { id: "mock", name: "Mock", version: "1.0.0", actions: [] },
    initialize: vi.fn().mockResolvedValue(undefined),
    enrichContext: vi.fn().mockResolvedValue(enrichData),
    getRiskInput: vi.fn().mockResolvedValue({
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }),
    getGuardrails: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({
      success: true,
      summary: "OK",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    }),
  } as unknown as Cartridge;
}

function createMockCartridgeRegistry(cartridges: Record<string, Cartridge>): CartridgeRegistry {
  return {
    get: (id: string) => cartridges[id] ?? null,
    register: vi.fn(),
    unregister: vi.fn().mockReturnValue(true),
    list: () => Object.keys(cartridges),
  };
}

describe("DefaultCrossCartridgeEnricher", () => {
  let entityStore: InMemoryEntityMappingStore;
  let entityService: EntityGraphService;

  beforeEach(() => {
    entityStore = new InMemoryEntityMappingStore();
    entityService = new EntityGraphService(entityStore);
  });

  it("enriches payments action with CRM contact data via entity graph", async () => {
    // Link CRM contact to payments customer
    await entityService.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    const crmCartridge = createMockCartridge({
      contactName: "Jane Doe",
      contactCompany: "Acme Inc",
    });

    const registry = createMockCartridgeRegistry({
      crm: crmCartridge,
      payments: createMockCartridge(),
    });

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName,contactCompany",
        enabled: true,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_1", amount: 500 },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm).toBeDefined();
    expect(result.crm!._available).toBe(true);
    expect(result.crm!.contactName).toBe("Jane Doe");
    expect(result.crm!.contactCompany).toBe("Acme Inc");
  });

  it("returns _available: false when entity mapping not found", async () => {
    const registry = createMockCartridgeRegistry({
      crm: createMockCartridge(),
    });

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: true,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_unknown" },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm!._available).toBe(false);
    expect(result.crm!._error).toContain("No entity mapping found");
  });

  it("returns _available: false when source cartridge not registered", async () => {
    await entityService.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    const registry = createMockCartridgeRegistry({}); // no cartridges

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: true,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_1" },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm!._available).toBe(false);
    expect(result.crm!._error).toContain("not registered");
  });

  it("handles enrichContext failure gracefully", async () => {
    await entityService.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    const failingCartridge = createMockCartridge();
    (failingCartridge.enrichContext as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection timeout"));

    const registry = createMockCartridgeRegistry({ crm: failingCartridge });

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: true,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    // Should not throw
    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_1" },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm!._available).toBe(false);
    expect(result.crm!._error).toBe("connection timeout");
  });

  it("skips disabled mappings", async () => {
    const registry = createMockCartridgeRegistry({
      crm: createMockCartridge({ contactName: "Jane" }),
    });

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: false,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_1" },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns _available: false when target entity param missing", async () => {
    const registry = createMockCartridgeRegistry({
      crm: createMockCartridge(),
    });

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: true,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { amount: 500 }, // no entityId
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm!._available).toBe(false);
    expect(result.crm!._error).toContain("not found in parameters");
  });

  it("enriches with multiple source cartridges", async () => {
    // Link all three cartridges
    await entityService.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
        { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_1" },
      ],
      "org_1",
      "admin",
    );

    const crmCartridge = createMockCartridge({ contactName: "Jane Doe" });
    const peCartridge = createMockCartridge({ journeyStage: "active_treatment" });

    const registry = createMockCartridgeRegistry({
      crm: crmCartridge,
      "patient-engagement": peCartridge,
    });

    const mappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: true,
      },
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "patient-engagement",
        targetEntityParam: "entityId",
        sourceEntityType: "patient",
        enrichmentHint: "journeyStage",
        enabled: true,
      },
    ];

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings,
    });

    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_1" },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm!._available).toBe(true);
    expect(result.crm!.contactName).toBe("Jane Doe");
    expect(result["patient-engagement"]!._available).toBe(true);
    expect(result["patient-engagement"]!.journeyStage).toBe("active_treatment");
  });
});
