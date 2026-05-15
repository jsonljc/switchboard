import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import type { OpportunityStore } from "@switchboard/core";
import { OpportunityNotFoundError, type OpportunityBoardRow } from "@switchboard/core/lifecycle";
import {
  buildTransitionOpportunityStageHandler,
  OPERATOR_INTENT_ERROR_CODES,
} from "../operator-intents.js";

function mkBoardRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "booked",
    timeline: null,
    priceReadiness: null,
    objections: [],
    qualificationComplete: true,
    estimatedValue: 1000,
    revenueTotal: 0,
    assignedAgent: null,
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-15T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: "2026-05-15T00:00:00.000Z",
    organizationId: "org_acme",
    actor: { id: "operator_1", type: "user" },
    intent: "operator.transition_opportunity_stage",
    parameters: { id: "opp_1", stage: "booked" },
    deployment: {
      deploymentId: "dep_op",
      skillSlug: "operator",
      trustLevel: "guided",
      trustScore: 100,
    },
    resolvedMode: "operator_mutation",
    traceId: "trace_1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  };
}

function makeStoreStub(overrides: Partial<OpportunityStore> = {}): OpportunityStore {
  return {
    transitionStage: vi.fn(),
    ...overrides,
  } as unknown as OpportunityStore;
}

describe("buildTransitionOpportunityStageHandler", () => {
  it("returns completed with opportunity output on success", async () => {
    const store = makeStoreStub({
      transitionStage: vi.fn().mockResolvedValue({
        opportunity: mkBoardRow({ id: "opp_1", stage: "booked" }),
        workTraceId: "wt_1",
      }),
    });
    const handler = buildTransitionOpportunityStageHandler(store);

    const result = await handler.execute(makeWorkUnit());

    expect(store.transitionStage).toHaveBeenCalledWith({
      orgId: "org_acme",
      id: "opp_1",
      stage: "booked",
      actor: { id: "operator_1", type: "user" },
    });
    expect(result.outcome).toBe("completed");
    const outputs = result.outputs as { opportunity: { id: string; stage: string } };
    expect(outputs.opportunity.id).toBe("opp_1");
    expect(outputs.opportunity.stage).toBe("booked");
  });

  it("maps OpportunityNotFoundError to outcome=failed with OPPORTUNITY_NOT_FOUND code", async () => {
    const store = makeStoreStub({
      transitionStage: vi.fn().mockRejectedValue(new OpportunityNotFoundError("opp_missing")),
    });
    const handler = buildTransitionOpportunityStageHandler(store);

    const result = await handler.execute(
      makeWorkUnit({ parameters: { id: "opp_missing", stage: "booked" } }),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND);
  });

  it("re-throws non-OpportunityNotFoundError errors so infra failures surface as 500", async () => {
    const store = makeStoreStub({
      transitionStage: vi.fn().mockRejectedValue(new Error("postgres connection lost")),
    });
    const handler = buildTransitionOpportunityStageHandler(store);

    await expect(handler.execute(makeWorkUnit())).rejects.toThrow("postgres connection lost");
  });

  it("rejects parameters that fail Zod validation (defense in depth)", async () => {
    const store = makeStoreStub();
    const handler = buildTransitionOpportunityStageHandler(store);

    await expect(
      handler.execute(makeWorkUnit({ parameters: { id: "", stage: "booked" } })),
    ).rejects.toThrow();
    expect(store.transitionStage).not.toHaveBeenCalled();
  });
});
