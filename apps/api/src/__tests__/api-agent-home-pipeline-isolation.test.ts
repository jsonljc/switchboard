import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("agent-home pipeline cross-org isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak Alex contacts from another org", async () => {
    await ctx.app.contactStore!.create({
      organizationId: "org-A",
      name: "Secret-A",
      phone: "+1000",
      email: null,
      primaryChannel: "whatsapp",
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/pipeline",
      headers: { "x-org-id": "org-B" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: { tiles: Array<{ name: string }>; totalCount: number } };
    expect(body.vm.totalCount).toBe(0);
    expect(body.vm.tiles.find((t) => t.name === "Secret-A")).toBeUndefined();
  });

  it("does not leak Riley pending recommendations from another org", async () => {
    await ctx.app.recommendationStore!.insert({
      idempotencyKey: "rec-secret",
      orgId: "org-A",
      agentKey: "riley",
      intent: "recommendation.pause_adset",
      action: "pause_adset",
      humanSummary: "Pause Secret Campaign",
      confidence: 0.7,
      dollarsAtRisk: 999,
      riskLevel: "high",
      surface: "queue",
      parameters: {},
      targetEntities: { campaignId: "secret-c", campaignName: "Secret Campaign" },
      sourceWorkflow: undefined,
      undoableUntil: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/pipeline",
      headers: { "x-org-id": "org-B" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: { tiles: Array<{ name: string }>; totalCount: number } };
    expect(body.vm.totalCount).toBe(0);
    expect(body.vm.tiles.find((t) => t.name === "Secret Campaign")).toBeUndefined();
  });
});
