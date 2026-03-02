import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryEntityMappingStore } from "../entity-graph/in-memory.js";
import { EntityGraphService } from "../entity-graph/service.js";
import { DefaultCrossCartridgeEnricher } from "../enrichment/enricher.js";
import { InMemoryEventBus } from "../event-bus/bus.js";
import { InMemoryEventReactionStore } from "../event-bus/in-memory-reaction-store.js";
import { EventReactionProcessor } from "../event-bus/processor.js";
import { DataFlowExecutor } from "../data-flow/executor.js";
import type { CartridgeRegistry } from "../storage/interfaces.js";
import type { Cartridge } from "@switchboard/cartridge-sdk";
import type { DomainEvent } from "../event-bus/types.js";
import type { EnrichmentMapping } from "../enrichment/types.js";

// --- Test helpers ---

function createMockCartridge(
  id: string,
  enrichData: Record<string, unknown> = {},
  executeData: Record<string, unknown> = {},
): Cartridge {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      actions: [
        { actionType: `${id}.action.do`, description: "Test action", riskLevel: "low" },
      ],
    },
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
      durationMs: 10,
      undoRecipe: null,
      data: executeData,
    }),
  } as unknown as Cartridge;
}

function createRegistry(cartridges: Record<string, Cartridge>): CartridgeRegistry {
  return {
    get: (id: string) => cartridges[id] ?? null,
    register: vi.fn(),
    unregister: vi.fn().mockReturnValue(true),
    list: () => Object.keys(cartridges),
  };
}

// --- Integration Tests ---

describe("Cross-Cartridge Integration (End-to-End)", () => {
  let entityStore: InMemoryEntityMappingStore;
  let entityService: EntityGraphService;
  let eventBus: InMemoryEventBus;
  let reactionStore: InMemoryEventReactionStore;

  beforeEach(() => {
    entityStore = new InMemoryEntityMappingStore();
    entityService = new EntityGraphService(entityStore);
    eventBus = new InMemoryEventBus();
    reactionStore = new InMemoryEventReactionStore();
  });

  it("full lifecycle: link entities → enrich → event → reaction → data-flow", async () => {
    // 1. ENTITY GRAPH: Link a patient across all cartridges
    const mapping = await entityService.link(
      [
        { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_123" },
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_456" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_789" },
      ],
      "org_acme",
      "admin_user",
      "Jane Doe - Full Patient",
    );

    expect(mapping.refs).toHaveLength(3);
    expect(mapping.label).toBe("Jane Doe - Full Patient");

    // Verify resolution in all directions
    const paymentId = await entityService.resolveToCartridge(
      { cartridgeId: "patient-engagement", entityType: "patient", entityId: "pat_123" },
      "payments",
      "customer",
      "org_acme",
    );
    expect(paymentId).toBe("cus_789");

    const crmId = await entityService.resolveToCartridge(
      { cartridgeId: "payments", entityType: "customer", entityId: "cus_789" },
      "crm",
      "contact",
      "org_acme",
    );
    expect(crmId).toBe("ct_456");

    // 2. ENRICHMENT: Create enricher and verify cross-cartridge data flows
    const crmCartridge = createMockCartridge("crm", {
      contactName: "Jane Doe",
      dealCount: 3,
      totalDealValue: 15000,
    });
    const paymentsCartridge = createMockCartridge("payments", {
      hasOpenDispute: false,
      totalLifetimeSpend: 8500,
    });
    const peCartridge = createMockCartridge("patient-engagement", {
      journeyStage: "active_treatment",
    });

    const registry = createRegistry({
      crm: crmCartridge,
      payments: paymentsCartridge,
      "patient-engagement": peCartridge,
    });

    const enrichmentMappings: EnrichmentMapping[] = [
      {
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName,dealCount",
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
      mappings: enrichmentMappings,
    });

    const enrichedContext = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_789", amount: 4000 },
      organizationId: "org_acme",
      principalId: "user_1",
    });

    expect(enrichedContext.crm!._available).toBe(true);
    expect(enrichedContext.crm!.contactName).toBe("Jane Doe");
    expect(enrichedContext["patient-engagement"]!._available).toBe(true);
    expect(enrichedContext["patient-engagement"]!.journeyStage).toBe("active_treatment");

    // 3. EVENT BUS: Set up event subscription and verify events flow
    const capturedEvents: DomainEvent[] = [];
    eventBus.subscribe("payments.*", async (event) => {
      capturedEvents.push(event);
    });

    const testEvent: DomainEvent = {
      id: "evt_test",
      eventType: "payments.invoice.created",
      sourceCartridgeId: "payments",
      organizationId: "org_acme",
      principalId: "user_1",
      payload: {
        customerId: "cus_789",
        amount: 4000,
        invoiceId: "inv_001",
      },
      envelopeId: "env_test",
      traceId: "trace_test",
      emittedAt: new Date(),
    };

    await eventBus.publish(testEvent);
    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]!.payload.invoiceId).toBe("inv_001");

    // 4. EVENT REACTIONS: Configure a reaction and process
    await reactionStore.save({
      id: "react_crm_log",
      name: "Log CRM activity on invoice",
      eventTypePattern: "payments.invoice.created",
      organizationId: "org_acme",
      targetAction: {
        cartridgeId: "crm",
        actionType: "crm.activity.log",
        parameterTemplate: {
          type: "note",
          subject: "Invoice created for $event.payload.amount",
          contactIds: ["$event.payload.customerId"],
        },
      },
      condition: null,
      enabled: true,
      priority: 10,
      actorId: "$event.principalId",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockOrchestrator = {
      propose: vi.fn().mockResolvedValue({
        denied: false,
        envelope: { id: "env_reaction", status: "approved" },
        explanation: "OK",
      }),
    };

    const reactionProcessor = new EventReactionProcessor({
      reactionStore,
      orchestrator: mockOrchestrator,
    });

    await reactionProcessor.process(testEvent);

    expect(mockOrchestrator.propose).toHaveBeenCalledTimes(1);
    const reactCall = mockOrchestrator.propose.mock.calls[0]![0];
    expect(reactCall.actionType).toBe("crm.activity.log");
    expect(reactCall.parameters.subject).toBe("Invoice created for 4000");
    expect(reactCall.parameters.contactIds).toEqual(["cus_789"]);
    expect(reactCall.principalId).toBe("user_1");
    expect(reactCall.parentEnvelopeId).toBe("env_test");

    // 5. DATA-FLOW: Execute a multi-step plan
    const dataFlowOrchestrator = {
      propose: vi.fn().mockResolvedValue({
        denied: false,
        envelope: { id: "env_df", status: "approved" },
        explanation: "OK",
      }),
      executeApproved: vi.fn()
        .mockResolvedValueOnce({
          success: true,
          summary: "Treatment logged",
          externalRefs: {},
          data: { value: 4000, treatmentType: "dental_crown" },
        })
        .mockResolvedValueOnce({
          success: true,
          summary: "Invoice created",
          externalRefs: { invoiceId: "inv_002" },
          data: {},
        })
        .mockResolvedValueOnce({
          success: true,
          summary: "Activity logged",
          externalRefs: {},
          data: {},
        }),
    };

    const dataFlowExecutor = new DataFlowExecutor({
      orchestrator: dataFlowOrchestrator,
      entityGraphService: entityService,
    });

    const result = await dataFlowExecutor.execute(
      {
        id: "plan_lifecycle",
        envelopeId: "env_plan",
        strategy: "sequential",
        approvalMode: "per_action",
        summary: "Treatment → Invoice → CRM Activity",
        steps: [
          {
            index: 0,
            cartridgeId: "patient-engagement",
            actionType: "patient-engagement.treatment.log",
            parameters: {
              patientId: "pat_123",
              treatmentType: "dental_crown",
              value: 4000,
            },
            condition: null,
          },
          {
            index: 1,
            cartridgeId: "payments",
            actionType: "payments.invoice.create",
            parameters: {
              entityId: "cus_789",
              amount: "$prev.result.data.value",
              description: "Treatment: $step[0].result.data.treatmentType",
            },
            condition: "$prev.result.success === true",
          },
          {
            index: 2,
            cartridgeId: "crm",
            actionType: "crm.activity.log",
            parameters: {
              type: "note",
              subject: "Treatment completed & invoiced",
              contactIds: ["ct_456"],
            },
            condition: "$prev.result.success === true",
          },
        ],
        deferredBindings: true,
      },
      {
        principalId: "user_1",
        organizationId: "org_acme",
        traceId: "trace_lifecycle",
      },
    );

    expect(result.overallOutcome).toBe("completed");
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults.every((s) => s.outcome === "executed")).toBe(true);

    // Verify data flowed between steps
    const step2Call = dataFlowOrchestrator.propose.mock.calls[1]![0];
    expect(step2Call.parameters.amount).toBe(4000);
    expect(step2Call.parameters.description).toBe("Treatment: dental_crown");

    // Verify all 3 steps went through governance
    expect(dataFlowOrchestrator.propose).toHaveBeenCalledTimes(3);
    expect(dataFlowOrchestrator.executeApproved).toHaveBeenCalledTimes(3);
  });

  it("entity graph isolation: different orgs don't cross-pollinate", async () => {
    await entityService.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_alpha",
      "admin",
    );

    // Different org cannot resolve the same entity
    const crossOrgResult = await entityService.resolveToCartridge(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "payments",
      "customer",
      "org_beta",
    );
    expect(crossOrgResult).toBeNull();

    // Same org resolves correctly
    const sameOrgResult = await entityService.resolveToCartridge(
      { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
      "payments",
      "customer",
      "org_alpha",
    );
    expect(sameOrgResult).toBe("cus_1");
  });

  it("event reaction chain depth prevention", async () => {
    let callCount = 0;
    const chainOrchestrator = {
      propose: vi.fn().mockImplementation(async () => {
        callCount++;
        // Each reaction triggers another event which triggers another reaction
        await chainProcessor.process({
          id: `evt_chain_${callCount}`,
          eventType: "payments.charge.created",
          sourceCartridgeId: "payments",
          organizationId: "org_1",
          principalId: "user_1",
          payload: {},
          envelopeId: `env_${callCount}`,
          traceId: "trace_chain", // Same traceId for chain tracking
          emittedAt: new Date(),
        });
        return { denied: false, envelope: { id: `env_${callCount}`, status: "approved" } };
      }),
    };

    const chainProcessor = new EventReactionProcessor({
      reactionStore,
      orchestrator: chainOrchestrator,
      maxChainDepth: 3,
    });

    await reactionStore.save({
      id: "react_chain",
      name: "Self-referencing reaction",
      eventTypePattern: "payments.*",
      organizationId: "org_1",
      targetAction: {
        cartridgeId: "payments",
        actionType: "payments.charge.create",
        parameterTemplate: {},
      },
      condition: null,
      enabled: true,
      priority: 1,
      actorId: "system",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await chainProcessor.process({
      id: "evt_start",
      eventType: "payments.charge.created",
      sourceCartridgeId: "payments",
      organizationId: "org_1",
      principalId: "user_1",
      payload: {},
      envelopeId: "env_start",
      traceId: "trace_chain",
      emittedAt: new Date(),
    });

    // Max depth 3: should have called propose exactly 3 times
    expect(callCount).toBe(3);
  });

  it("enrichment gracefully handles unavailable cartridges", async () => {
    await entityService.link(
      [
        { cartridgeId: "crm", entityType: "contact", entityId: "ct_1" },
        { cartridgeId: "payments", entityType: "customer", entityId: "cus_1" },
      ],
      "org_1",
      "admin",
    );

    // CRM cartridge throws on enrichContext
    const failingCrm = createMockCartridge("crm");
    (failingCrm.enrichContext as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("CRM service down"),
    );

    const registry = createRegistry({ crm: failingCrm });

    const enricher = new DefaultCrossCartridgeEnricher({
      entityGraphService: entityService,
      cartridgeRegistry: registry,
      mappings: [{
        targetCartridgeId: "payments",
        sourceCartridgeId: "crm",
        targetEntityParam: "entityId",
        sourceEntityType: "contact",
        enrichmentHint: "contactName",
        enabled: true,
      }],
    });

    // Should NOT throw
    const result = await enricher.enrich({
      targetCartridgeId: "payments",
      actionType: "payments.invoice.create",
      parameters: { entityId: "cus_1" },
      organizationId: "org_1",
      principalId: "user_1",
    });

    expect(result.crm!._available).toBe(false);
    expect(result.crm!._error).toBe("CRM service down");
  });
});
