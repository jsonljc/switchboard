import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

const IDEMPOTENCY_HEADERS = { "Idempotency-Key": "test-key-execute" };

describe("Execute API (POST /api/execute)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 400 when Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      payload: {
        actorId: "default",
        action: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          sideEffect: true,
        },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("Idempotency-Key");
  });

  it("returns 200 with outcome EXECUTED when auto-approved", async () => {
    // Trust this action so it is auto-approved (no approval gate)
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Default identity spec for testing",
      riskTolerance: {
        none: "none" as const,
        low: "none" as const,
        medium: "none" as const,
        high: "none" as const,
        critical: "mandatory" as const,
      },
      globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: [],
      trustBehaviors: ["ads.campaign.pause"],
      delegatedApprovers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        action: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("EXECUTED");
    expect(body.envelopeId).toBeDefined();
    expect(body.traceId).toBeDefined();
    expect(body.executionResult).toBeDefined();
    expect(body.executionResult.success).toBe(true);
  });

  it("returns 200 with outcome DENIED for forbidden behavior", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Default identity spec for testing",
      riskTolerance: {
        none: "none" as const,
        low: "none" as const,
        medium: "standard" as const,
        high: "elevated" as const,
        critical: "mandatory" as const,
      },
      globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: ["ads.campaign.pause"],
      trustBehaviors: [],
      delegatedApprovers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        action: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("DENIED");
    expect(body.envelopeId).toBeDefined();
    expect(body.traceId).toBeDefined();
    expect(body.deniedExplanation).toBeDefined();
  });

  it("returns 400 when actionType cannot infer cartridge", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        action: {
          actionType: "unknown.action",
          parameters: {},
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("cartridgeId");
  });

  it("returns 400 when body fails validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        action: {
          actionType: "ads.campaign.pause",
          parameters: {},
          // missing required sideEffect
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
  });
});
