import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

const IDEMPOTENCY_HEADERS = { "Idempotency-Key": "test-key-execute" };
const ORG_ID = "org_test";

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
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          sideEffect: true,
        },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("Idempotency-Key");
  });

  it("returns 400 when organizationId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          sideEffect: true,
        },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("organizationId");
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
      trustBehaviors: ["digital-ads.campaign.pause"],
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
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
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
      forbiddenBehaviors: ["digital-ads.campaign.pause"],
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
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
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

  it("returns 404 when intent is not found", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "unknown.action",
          parameters: {},
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toContain("Intent not found");
  });

  it("persists an approval record when execution returns PENDING_APPROVAL", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Approval-path test spec",
      riskTolerance: {
        none: "none" as const,
        low: "standard" as const,
        medium: "elevated" as const,
        high: "mandatory" as const,
        critical: "mandatory" as const,
      },
      globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: [],
      trustBehaviors: [],
      delegatedApprovers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "Idempotency-Key": "approval-persist-key" },
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_needs_approval" },
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("PENDING_APPROVAL");
    expect(body.approvalRequest).toBeDefined();
    expect(body.approvalRequest.id).toBeTruthy();
    expect(body.approvalRequest.bindingHash).toBeTruthy();

    const persisted = await app.storageContext.approvals.getById(body.approvalRequest.id);
    expect(persisted).not.toBeNull();
    expect(persisted?.envelopeId).toBe(body.envelopeId);
  });

  it("returns 400 when body fails validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
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
