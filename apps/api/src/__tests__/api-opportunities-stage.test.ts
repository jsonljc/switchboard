import { describe, it, expect, beforeEach } from "vitest";
import { PipelineBoardOpportunitySchema } from "@switchboard/schemas";
import { buildTestServer } from "./test-server.js";
import type { FastifyInstance } from "fastify";
import type { OpportunityBoardRow } from "@switchboard/core/lifecycle";

function mkRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
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

describe("PATCH /api/dashboard/opportunities/:id/stage", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const built = await buildTestServer();
    app = built.app;
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([
      mkRow({ id: "opp_1", organizationId: "org_acme" }),
      mkRow({ id: "opp_other_org", organizationId: "org_other" }),
    ]);
  });

  it("returns 200 { opportunity } parseable by PipelineBoardOpportunitySchema", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { opportunity: unknown };
    const opp = PipelineBoardOpportunitySchema.parse(body.opportunity);
    expect(opp.stage).toBe("booked");
  });

  it("writes a WorkTrace with ingressPath store_recorded_operator_mutation", async () => {
    const store = app.opportunityStore as unknown as {
      lastTraceWritten: {
        ingressPath: string;
        intent: string;
        parameters: Record<string, unknown>;
      } | null;
    };
    await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(store.lastTraceWritten).toEqual({
      ingressPath: "store_recorded_operator_mutation",
      intent: "opportunity.stage_transition",
      parameters: {
        opportunityId: "opp_1",
        contactId: "c_1",
        fromStage: "quoted",
        toStage: "booked",
      },
    });
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_does_not_exist/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "OPPORTUNITY_NOT_FOUND" });
  });

  it("returns 404 for cross-tenant id (org A's opportunity from org B's session)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_other_org/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid stage", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "not_a_valid_stage" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "INVALID_BODY" });
  });

  it("returns 400 for missing stage", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when opportunityStore is null", async () => {
    const built = await buildTestServer({ opportunityStore: null });
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "booked" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("emits a WorkTrace on idempotent same-stage PATCH (quoted → quoted)", async () => {
    const store = app.opportunityStore as unknown as {
      lastTraceWritten: { parameters: Record<string, unknown> } | null;
    };
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "quoted" },
    });
    expect(res.statusCode).toBe(200);
    expect(store.lastTraceWritten?.parameters).toMatchObject({
      fromStage: "quoted",
      toStage: "quoted",
    });
  });

  it("sets closedAt on terminal transition (quoted → won)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_1/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "won" },
    });
    const body = res.json() as { opportunity: { closedAt: string | null } };
    expect(body.opportunity.closedAt).toBeTruthy();
    expect(typeof body.opportunity.closedAt).toBe("string");
  });

  it("clears closedAt when leaving a terminal stage", async () => {
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([
      mkRow({ id: "opp_w", organizationId: "org_acme", stage: "won", closedAt: new Date() }),
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_w/stage",
      headers: { "x-org-id": "org_acme", "content-type": "application/json" },
      payload: { stage: "quoted" },
    });
    const body = res.json() as { opportunity: { closedAt: string | null } };
    expect(body.opportunity.closedAt).toBeNull();
  });
});
