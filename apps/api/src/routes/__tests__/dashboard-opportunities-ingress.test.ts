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
      headers: {
        "x-org-id": "org_acme",
        "content-type": "application/json",
        "idempotency-key": "happy-path-key-1",
      },
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
      headers: {
        "x-org-id": "org_acme",
        "content-type": "application/json",
        "idempotency-key": "error-path-key-1",
      },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "OPPORTUNITY_NOT_FOUND" });

    // Failed-outcome WorkTrace is still persisted (governed evidence even on failure).
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.outcome).toBe("failed");
  });

  it("produces exactly one WorkTrace per stage transition — the ingress one (no legacy store-side trace)", async () => {
    // Regression guard for Phase 1b.1 cleanup: prior to this slice, both the
    // route's PlatformIngress submission AND the opportunity store's internal
    // bypass wrote separate WorkTraces. The cleanup strips the store-side
    // bypass so exactly one canonical WorkTrace remains per operator mutation.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_ingress_1/stage",
      headers: {
        "x-org-id": "org_acme",
        "content-type": "application/json",
        "idempotency-key": "single-trace-key-1",
      },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(200);

    expect(app.ingressTraceCount).toBe(1);
    expect(app.lastIngressTrace?.intent).toBe("operator.transition_opportunity_stage");
    expect(app.lastIngressTrace?.mode).toBe("operator_mutation");
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

describe("PATCH /:id/stage — Route Governance Contract v1 PR-1", () => {
  it("returns 400 missing_idempotency_key when header absent", async () => {
    const { app } = await buildTestServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_does_not_matter/stage",
      payload: { stage: "qualified" },
      // intentionally NO Idempotency-Key header
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    await app.close();
  });

  it("happy path: header present, narrowed orgId/actorId reach handler", async () => {
    const { app } = await buildTestServer();
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([mkRow({ id: "opp_rg_1", organizationId: "default", stage: "quoted" })]);

    // Asserting `.toBe(200)` (not `.toBeLessThan(500)`) pins this as the
    // canonical regression guard for the dev-fallback "default" org path:
    // if buildDevAuthFallback stops defaulting the org, or replyValidationError
    // drifts, or the org-scoped lookup misses, we want this to fail loudly
    // instead of silently passing on a 4xx. See PR #614 ultrareview bug_002.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_rg_1/stage",
      headers: { "idempotency-key": "key-stage-1" },
      payload: { stage: "qualified" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { opportunity: { stage: string } };
    expect(body.opportunity.stage).toBe("qualified");
    await app.close();
  });
});
