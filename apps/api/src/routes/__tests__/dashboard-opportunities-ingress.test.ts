import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { OpportunityBoardRow } from "@switchboard/core/lifecycle";
import { buildTestServer } from "../../__tests__/test-server.js";

function mkRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_ingress_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "quoted",
    timeline: null,
    priceReadiness: null,
    objections: [],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: null,
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

describe("PATCH /api/dashboard/opportunities/:id/stage — PlatformIngress migration (Phase 1b.1)", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const built = await buildTestServer();
    app = built.app;
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([mkRow({ id: "opp_ingress_1", organizationId: "org_acme", stage: "quoted" })]);
  });

  it("happy path: enters PlatformIngress and persists an ingress WorkTrace with mode=operator_mutation", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_ingress_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { opportunity: { id: string; stage: string } };
    expect(body.opportunity.stage).toBe("booked");

    // Proves the route entered PlatformIngress (and not the old direct service call):
    // the test harness captures every workTraceStore.persist() call as lastIngressTrace.
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.transition_opportunity_stage");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("org_acme");
    expect(last!.outcome).toBe("completed");
  });

  it("error path: handler returns failed outcome → route maps to 404 OPPORTUNITY_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_does_not_exist/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "OPPORTUNITY_NOT_FOUND" });

    // Failed-outcome WorkTrace is still persisted (governed evidence even on failure).
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.outcome).toBe("failed");
  });

  it("idempotency path: same Idempotency-Key + payload returns the cached result on second call", async () => {
    const idempotencyKey = "test-idempotency-key-opp-1";

    const first = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_ingress_1/stage",
      headers: {
        "x-org-id": "org_acme",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: { stage: "booked" },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { opportunity: { stage: string; updatedAt: string } };
    expect(firstBody.opportunity.stage).toBe("booked");

    const second = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_ingress_1/stage",
      headers: {
        "x-org-id": "org_acme",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: { stage: "booked" },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { opportunity: { stage: string; updatedAt: string } };
    // Cached replay returns the exact same opportunity payload (updatedAt unchanged).
    expect(secondBody.opportunity.updatedAt).toBe(firstBody.opportunity.updatedAt);
  });
});
