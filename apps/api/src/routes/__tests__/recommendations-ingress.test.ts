import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { emitRecommendation } from "@switchboard/core";
import { buildTestServer } from "../../__tests__/test-server.js";

async function seedRec(app: FastifyInstance, orgId = "default") {
  const result = await emitRecommendation(app.recommendationStore!, {
    orgId,
    agentKey: "alex",
    intent: "recommendation.ad_set_pause",
    action: "pause",
    humanSummary: "PR-1 test rec",
    confidence: 0.6,
    dollarsAtRisk: 100,
    riskLevel: "low",
    parameters: {},
    presentation: {
      primaryLabel: "Pause",
      secondaryLabel: "Reduce",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    targetEntities: { campaignId: `c-pr1-${Date.now()}` },
  });
  if (result.surface === "dropped") throw new Error("seed must not drop");
  return result;
}

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
      headers: { "Idempotency-Key": `happy-${rec.id}` },
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
      headers: { "Idempotency-Key": `invalid-${rec.id}` },
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

    // Since #575, buildDevAuthFallback runs as a global preHandler before the
    // idempotency middleware, so organizationIdFromAuth / principalIdFromAuth are
    // resolved (from x-org-id / x-principal-id) at both the check-time preHandler and
    // the store-time onSend. The fingerprint is stable across both legs without the
    // old x-organization-id band-aid.
    const commonHeaders = {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-org-id": "default",
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

describe("POST /:id/act — Route Governance Contract v1 PR-1", () => {
  it("returns 400 missing_idempotency_key when Idempotency-Key header absent", async () => {
    const { app } = await buildTestServer();
    const rec = await seedRec(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "primary" },
      // intentionally NO Idempotency-Key header
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    await app.close();
  });

  it("persists a WorkTrace with failed-RECOMMENDATION_NOT_FOUND for cross-tenant act", async () => {
    const { app } = await buildTestServer();
    const rec = await seedRec(app, "org_other");
    const prev = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      headers: { "Idempotency-Key": "key-xtenant-1", "x-org-id": "org_a" },
      payload: { action: "primary" },
    });

    expect(res.statusCode).toBe(404);
    expect(app.ingressTraceCount).toBe(prev + 1);
    expect(app.lastIngressTrace?.outcome).toBe("failed");
    expect(app.lastIngressTrace?.error?.code).toBe("RECOMMENDATION_NOT_FOUND");
    await app.close();
  });

  it("happy path still passes with new contract", async () => {
    const { app } = await buildTestServer();
    const rec = await seedRec(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      headers: { "Idempotency-Key": "key-happy-1" },
      payload: { action: "primary" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
