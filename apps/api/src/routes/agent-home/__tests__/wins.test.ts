import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";

describe("GET /api/dashboard/agents/:agentId/wins", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns 200 with WinsViewModel when wins exist", async () => {
    vi.spyOn(ctx.app.recommendationStore!, "listResolvedForAgent").mockResolvedValue([
      {
        id: "r1",
        idempotencyKey: "k1",
        intent: "recommendation.send_tour_invite",
        status: "confirmed",
        agentKey: "alex",
        orgId: "org-A",
        humanSummary: "Sent invite to Maya",
        confidence: 0.7,
        riskLevel: "low",
        dollarsAtRisk: 0,
        targetEntities: {},
        parameters: {},
        approvalRequired: "operator",
        surface: "queue",
        undoableUntil: new Date(Date.now() + 60_000),
        actedAt: new Date(),
        actedBy: "u1",
        createdAt: new Date(),
        expiresAt: null,
        sourceWorkflow: null,
      } as never,
    ]);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins?window=today",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      vm: { wins: unknown[]; hasMore: boolean; freshness: { dataSource: string } };
    };
    expect(body.vm.wins).toHaveLength(1);
    expect(body.vm.hasMore).toBe(false);
    expect(body.vm.freshness.dataSource).toBe("live");
  });

  it("returns 404 for mira", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for unknown agent key", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/zoe/wins",
      headers: { "x-org-id": "org-A" },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  it("defaults window to today when omitted", async () => {
    const spy = vi
      .spyOn(ctx.app.recommendationStore!, "listResolvedForAgent")
      .mockResolvedValue([]);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown window values", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins?window=year",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(400);
  });
});
