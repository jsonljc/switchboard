import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { emitRecommendation } from "@switchboard/core";
import { buildTestServer } from "../../__tests__/test-server.js";

describe("POST /api/recommendations/:id/act — PlatformIngress migration (Phase 1b.2)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildTestServer();
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedQueueRec(orgId = "default") {
    const result = await emitRecommendation(app.recommendationStore!, {
      orgId,
      agentKey: "alex",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Test ingress recommendation",
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
      targetEntities: { campaignId: `c-ingress-${Date.now()}` },
    });
    if (result.surface === "dropped") throw new Error("seed must not drop");
    return result;
  }

  it("happy path: enters PlatformIngress and persists an ingress WorkTrace with mode=operator_mutation", async () => {
    const rec = await seedQueueRec();

    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "primary" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { recommendation: { status: string } };
    expect(body.recommendation.status).toBe("acted");

    // Proves the route entered PlatformIngress (not the old direct service call):
    // the test harness captures every workTraceStore.persist() call as lastIngressTrace.
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.act_on_recommendation");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("default");
    expect(last!.outcome).toBe("completed");
  });

  it("failed-outcome path: invalid action for surface returns 400 + ingress trace outcome=failed", async () => {
    const rec = await seedQueueRec();

    // "confirm" is invalid on a queue-surface recommendation (queue only accepts primary|secondary|dismiss)
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "confirm" },
    });

    expect(res.statusCode).toBe(400);

    // Failed-outcome WorkTrace is still persisted (governed evidence even on failure).
    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.act_on_recommendation");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.outcome).toBe("failed");
  });

  it("idempotency path: same Idempotency-Key + payload returns the cached result on second call", async () => {
    const rec = await seedQueueRec();
    const idempotencyKey = `test-idempotency-key-rec-${rec.id}`;

    // The idempotency middleware fingerprint uses organizationIdFromAuth and
    // principalIdFromAuth, which are set by the route's preHandler AFTER the
    // global idempotency preHandler fires. Supplying x-organization-id and
    // x-principal-id ensures the fingerprint is stable across both calls (the
    // middleware falls back to these headers when the auth fields are not yet set).
    const commonHeaders = {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-organization-id": "default",
      "x-principal-id": "default",
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      headers: commonHeaders,
      payload: { action: "primary" },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      recommendation: { status: string; actedAt: string | null };
    };
    expect(firstBody.recommendation.status).toBe("acted");

    const second = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      headers: commonHeaders,
      payload: { action: "primary" },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      recommendation: { status: string; actedAt: string | null };
    };
    // Cached replay returns the exact same recommendation payload (actedAt unchanged).
    expect(secondBody.recommendation.actedAt).toBe(firstBody.recommendation.actedAt);
  });
});
