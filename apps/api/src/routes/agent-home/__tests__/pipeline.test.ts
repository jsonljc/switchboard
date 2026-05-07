import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";

describe("GET /api/dashboard/agents/:agentId/pipeline", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns 200 with PipelineViewModel for Alex", async () => {
    vi.spyOn(ctx.app.contactStore!, "listForPipeline").mockResolvedValue({
      rows: [
        {
          id: "c1",
          organizationId: "org-A",
          name: "Maya",
          phone: null,
          email: null,
          primaryChannel: "whatsapp",
          firstTouchChannel: null,
          stage: "active",
          source: null,
          attribution: null,
          roles: ["lead"],
          firstContactAt: new Date(),
          lastActivityAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      totalCount: 1,
    } as never);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/pipeline",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      vm: { agentKey: string; tiles: unknown[]; totalCount: number };
    };
    expect(body.vm.agentKey).toBe("alex");
    expect(body.vm.tiles).toHaveLength(1);
    expect(body.vm.totalCount).toBe(1);
  });

  it("returns 200 with PipelineViewModel for Riley", async () => {
    vi.spyOn(ctx.app.recommendationStore!, "listPendingForAgent").mockResolvedValue({
      rows: [
        {
          id: "p1",
          orgId: "org-A",
          agentKey: "riley",
          intent: "recommendation.pause_adset",
          status: "pending",
          humanSummary: "Pause Whitening A",
          confidence: 0.6,
          riskLevel: "high",
          dollarsAtRisk: 420,
          targetEntities: { campaignId: "c-1", campaignName: "Whitening A" },
          parameters: {},
          surface: "queue",
          undoableUntil: null,
          actedAt: null,
          actedBy: null,
          note: null,
          sourceAgent: "riley",
          sourceWorkflow: null,
          createdAt: new Date(),
          expiresAt: null,
        },
      ],
      totalCount: 1,
    } as never);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/pipeline",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: { agentKey: string; tiles: unknown[] } };
    expect(body.vm.agentKey).toBe("riley");
    expect(body.vm.tiles).toHaveLength(1);
  });

  it("drops Riley rows with malformed targetEntities and logs a warning", async () => {
    const warnSpy = vi.spyOn(ctx.app.log, "warn");
    vi.spyOn(ctx.app.recommendationStore!, "listPendingForAgent").mockResolvedValue({
      rows: [
        {
          id: "p-bad",
          orgId: "org-A",
          agentKey: "riley",
          intent: "recommendation.pause_adset",
          status: "pending",
          humanSummary: "Pause something",
          confidence: 0.6,
          riskLevel: "high",
          dollarsAtRisk: 100,
          targetEntities: {}, // missing campaignId/campaignName
          parameters: {},
          surface: "queue",
          undoableUntil: null,
          actedAt: null,
          actedBy: null,
          note: null,
          sourceAgent: "riley",
          sourceWorkflow: null,
          createdAt: new Date(),
          expiresAt: null,
        },
      ],
      totalCount: 1,
    } as never);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/pipeline",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: { tiles: unknown[] } };
    expect(body.vm.tiles).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ pendingActionRecordId: "p-bad", orgId: "org-A" }),
      expect.stringContaining("pipeline-riley:"),
    );
  });

  it("returns 404 for mira", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/pipeline",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 503 when Alex's contactStore is unavailable", async () => {
    ctx.app.contactStore = undefined;
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/pipeline",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("Alex still works when only recommendationStore is unavailable", async () => {
    ctx.app.recommendationStore = undefined;
    vi.spyOn(ctx.app.contactStore!, "listForPipeline").mockResolvedValue({
      rows: [],
      totalCount: 0,
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/pipeline",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
  });
});
