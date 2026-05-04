import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("GET /api/dashboard/decisions — cross-tenant isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak decisions from another org", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-A",
      agentKey: "alex",
      intent: "recommendation.x",
      action: "approve",
      humanSummary: "secret-A",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: { primaryLabel: "p", secondaryLabel: "s", dismissLabel: "d", dataLines: [] },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/decisions",
      headers: { "x-org-id": "org-B" },
    });
    const body = res.json() as { decisions: Array<{ humanSummary: string }> };
    const summaries = body.decisions.map((d) => d.humanSummary);
    expect(summaries).not.toContain("secret-A");
  });
});
