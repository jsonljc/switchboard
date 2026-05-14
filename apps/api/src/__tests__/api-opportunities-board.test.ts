import { describe, it, expect, beforeEach } from "vitest";
import { PipelineBoardResponseSchema } from "@switchboard/schemas";
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
    timeline: "soon",
    priceReadiness: "flexible",
    objections: [],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: "alex",
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

describe("GET /api/dashboard/opportunities", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    ({ app } = await buildTestServer());
  });

  it("returns { rows } parseable by PipelineBoardResponseSchema", async () => {
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([mkRow()]);

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_acme" },
    });
    expect(res.statusCode).toBe(200);
    const parsed = PipelineBoardResponseSchema.parse(res.json());
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.id).toBe("opp_1");
    expect(typeof parsed.rows[0]!.openedAt).toBe("string");
  });

  it("scopes to the request's organizationId — cross-tenant rows are excluded", async () => {
    const store = app.opportunityStore as unknown as {
      seedBoard: (rows: OpportunityBoardRow[]) => void;
    };
    store.seedBoard([
      mkRow({ id: "opp_a", organizationId: "org_acme" }),
      mkRow({ id: "opp_b", organizationId: "org_other" }),
    ]);

    const resAcme = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_acme" },
    });
    expect(resAcme.json().rows.map((r: { id: string }) => r.id)).toEqual(["opp_a"]);

    const resOther = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_other" },
    });
    expect(resOther.json().rows.map((r: { id: string }) => r.id)).toEqual(["opp_b"]);
  });

  it("returns [] for an org with no opportunities (not 404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_empty" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [] });
  });

  it("returns 503 when app.opportunityStore is null", async () => {
    const { app: appNoStore } = await buildTestServer({ opportunityStore: null });
    const res = await appNoStore.inject({
      method: "GET",
      url: "/api/dashboard/opportunities",
      headers: { "x-org-id": "org_acme" },
    });
    expect(res.statusCode).toBe(503);
  });
});
