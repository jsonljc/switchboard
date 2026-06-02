import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("GET /api/dashboard/agents/:agentId/wins — cross-tenant isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak wins from another org", async () => {
    // Emit and resolve a recommendation for org-A
    const rec = await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-A",
      agentKey: "alex",
      intent: "recommendation.x",
      action: "approve",
      humanSummary: "secret-A-win",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "p",
        secondaryLabel: "s",
        dismissLabel: "d",
        dataLines: [],
      },
    });
    if (rec.surface === "dropped" || !rec.id) {
      throw new Error("Failed to emit recommendation");
    }
    await ctx.app.recommendationStore!.applyAct({
      id: rec.id,
      orgId: "org-A",
      actor: { principalId: "u-A", type: "operator" },
      fromStatus: "pending",
      toStatus: "acted",
      note: undefined,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/wins?window=today",
      headers: { "x-org-id": "org-B" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      vm: { wins: Array<{ proseSegments: Array<{ text: string }> }> };
    };
    const allText = body.vm.wins.flatMap((w) => w.proseSegments.map((s) => s.text)).join(" ");
    expect(allText).not.toContain("secret-A-win");
  });
});
