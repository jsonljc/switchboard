import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("Recommendations API — multi-org isolation", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  // The test server runs requests as orgId "default" (per its auth disabled / seeded identity).
  // Seed a row with a different orgId and assert it cannot leak.

  it("requests as default cannot list rows belonging to org-b", async () => {
    await emitRecommendation(app.recommendationStore!, {
      orgId: "org-b",
      agentKey: "alex",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "leakage canary",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
      targetEntities: { campaignId: "iso-canary" },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/recommendations?surface=queue",
    });
    expect(res.statusCode).toBe(200);
    expect(
      res
        .json()
        .recommendations.find((r: { humanSummary: string }) => r.humanSummary === "leakage canary"),
    ).toBeUndefined();
  });

  it("requests as default cannot act on org-b row (404 hides existence)", async () => {
    const seeded = await emitRecommendation(app.recommendationStore!, {
      orgId: "org-b",
      agentKey: "alex",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "x",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
      targetEntities: { campaignId: "iso-canary-2" },
    });
    if (seeded.surface === "dropped") throw new Error("seed must not drop");
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${seeded.id}/act`,
      headers: { "Idempotency-Key": `iso-${seeded.id}` },
      payload: { action: "primary" },
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
