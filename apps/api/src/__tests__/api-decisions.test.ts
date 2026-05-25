import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("GET /api/dashboard/agents/:key/decisions", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns recommendations for the agent (kind: 'approval')", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-1",
      agentKey: "riley",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Pause Q2-LA",
      confidence: 0.6,
      dollarsAtRisk: 400,
      riskLevel: "medium",
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/decisions",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { decisions: Array<{ kind: string; agentKey: string }> };
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]!.kind).toBe("approval");
    expect(body.decisions[0]!.agentKey).toBe("riley");
  });

  it("filters by agent key (decisions for other agents are excluded)", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-1",
      agentKey: "alex",
      intent: "recommendation.lead_reply",
      action: "approve",
      humanSummary: "Approve reply to Maya",
      confidence: 0.7,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "Approve",
        secondaryLabel: "Edit",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/decisions",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { decisions: Array<unknown> };
    expect(body.decisions).toHaveLength(0);
  });

  it("includes counts in the response", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-1",
      agentKey: "alex",
      intent: "recommendation.x",
      action: "approve",
      humanSummary: "x",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: { primaryLabel: "a", secondaryLabel: "b", dismissLabel: "c", dataLines: [] },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/decisions",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { counts: { total: number; approval: number; handoff: number } };
    expect(body.counts.total).toBeGreaterThanOrEqual(1);
    expect(body.counts).toHaveProperty("approval");
    expect(body.counts).toHaveProperty("handoff");
  });

  it("returns 400 for unknown agent key", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/unknown/decisions",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("serializes riskContract fields onto the wire response (financialEffect)", async () => {
    // HF3(e): wire-level guard — serializeDecision spreads meta which includes riskContract.
    // Emit a recommendation with financialEffect: true and assert it reaches the response body.
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-2",
      agentKey: "alex",
      intent: "recommendation.lead_reply",
      action: "approve",
      humanSummary: "Approve high-value reply",
      confidence: 0.85,
      dollarsAtRisk: 800,
      riskLevel: "high",
      financialEffect: true,
      externalEffect: true,
      clientFacing: true,
      requiresConfirmation: true,
      parameters: {},
      presentation: {
        primaryLabel: "Approve",
        secondaryLabel: "Edit",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/decisions",
      headers: { "x-org-id": "org-2" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      decisions: Array<{
        meta: {
          riskContract?: {
            financialEffect: boolean;
            externalEffect: boolean;
            clientFacing: boolean;
            requiresConfirmation: boolean;
            riskLevel: string;
          };
        };
      }>;
    };
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]!.meta.riskContract).toBeDefined();
    expect(body.decisions[0]!.meta.riskContract!.financialEffect).toBe(true);
    expect(body.decisions[0]!.meta.riskContract!.externalEffect).toBe(true);
    expect(body.decisions[0]!.meta.riskContract!.clientFacing).toBe(true);
    expect(body.decisions[0]!.meta.riskContract!.requiresConfirmation).toBe(true);
    expect(body.decisions[0]!.meta.riskContract!.riskLevel).toBe("high");
  });
});
