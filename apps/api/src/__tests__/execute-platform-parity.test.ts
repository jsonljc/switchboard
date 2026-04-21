import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { WorkTrace } from "@switchboard/core/platform";

const IDEMPOTENCY_HEADERS = { "Idempotency-Key": "parity-test-key" };
const ORG_ID = "org_parity";

describe("POST /api/execute — Platform Ingress Parity", () => {
  let app: FastifyInstance;
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  // --- Parity criterion 1: Same governance outcome (allowed → EXECUTED) ---
  // Already covered in api-execute.test.ts — skip duplication

  // --- Parity criterion 2: Same side-effect result (cartridge action executes) ---
  it("EXECUTED response includes cartridge-produced externalRefs in executionResult", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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
          parameters: { campaignId: "camp_side_effect" },
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("EXECUTED");
    // Cartridge returns externalRefs with the campaignId passed in
    expect(body.executionResult).toBeDefined();
    expect(body.executionResult.externalRefs).toBeDefined();
    expect(body.executionResult.externalRefs.campaignId).toBe("camp_side_effect");
  });

  // --- Parity criterion 3: Idempotency-Key required ---
  // Already covered in api-execute.test.ts — skip duplication

  // --- Parity criterion 4: Same error shape (404 for unknown intent) ---
  // Already covered in api-execute.test.ts — skip duplication

  // --- Parity criterion 5: DENIED vs FAILED distinction ---
  it("returns DENIED (not FAILED) when governance denies the action", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.outcome).toBe("DENIED");
    // DENIED has deniedExplanation, NOT error
    expect(body.deniedExplanation).toBeDefined();
    expect(body.error).toBeUndefined();
  });

  it("returns FAILED (not DENIED) when cartridge execution fails", async () => {
    // Set up trusted behavior so governance allows execution
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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

    // Make the cartridge return a failure result
    ctx.cartridge.onExecute(() => ({
      success: false,
      summary: "Campaign not found",
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 5,
      undoRecipe: null,
    }));

    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_nonexistent" },
          sideEffect: true,
        },
      },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.outcome).toBe("FAILED");
    // FAILED has error, NOT deniedExplanation
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("CARTRIDGE_ERROR");
    expect(body.deniedExplanation).toBeUndefined();
  });

  // --- Parity criterion 6: Approval path ---
  it("returns PENDING_APPROVAL when governance requires approval", async () => {
    // Set up identity that requires elevated approval for medium risk
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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
      headers: IDEMPOTENCY_HEADERS,
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_approval" },
          sideEffect: true,
        },
      },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.outcome).toBe("PENDING_APPROVAL");
    expect(body.envelopeId).toBeDefined();
    expect(body.traceId).toBeDefined();
    expect(body.approvalRequest).toBeDefined();
    expect(body.approvalRequest.id).toBeTruthy();
    expect(body.approvalRequest.bindingHash).toBeTruthy();
  });

  // --- Parity criterion 7: Response envelope shape ---
  it("response always includes envelopeId and traceId on success path", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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
          parameters: { campaignId: "camp_envelope" },
          sideEffect: true,
        },
      },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    // envelopeId is derived from WorkUnit.id (cuid2)
    expect(typeof body.envelopeId).toBe("string");
    expect(body.envelopeId.length).toBeGreaterThan(0);
    // traceId is a cuid2 string
    expect(body.traceId).toBeDefined();
    expect(typeof body.traceId).toBe("string");
    expect(body.traceId.length).toBeGreaterThan(0);
  });

  // --- Parity criterion 8: No direct executionService usage in route ---
  it("execute route source uses platformIngress.submit(), not executionService", () => {
    const routeSource = readFileSync(resolve(import.meta.dirname, "../routes/execute.ts"), "utf-8");
    // Route must use PlatformIngress
    expect(routeSource).toContain("platformIngress.submit");
    // Route must NOT call executionService directly
    expect(routeSource).not.toContain("executionService");
    expect(routeSource).not.toContain("orchestrator.resolveAndPropose");
  });

  // --- Parity criterion 9: WorkTrace persistence ---
  it("persists WorkTrace when traceStore is configured", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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

    const traces: WorkTrace[] = [];
    const mockTraceStore = {
      persist: vi.fn(async (trace: WorkTrace) => {
        traces.push(trace);
      }),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app.platformIngress as any).config.traceStore = mockTraceStore;

    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "Idempotency-Key": "parity-trace-key" },
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_trace" },
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockTraceStore.persist).toHaveBeenCalledOnce();
    const trace = traces[0]!;
    expect(trace.intent).toBe("digital-ads.campaign.pause");
    expect(trace.organizationId).toBe(ORG_ID);
    expect(trace.governanceOutcome).toBe("execute");
    expect(trace.outcome).toBe("completed");
    expect(typeof trace.riskScore).toBe("number");
    expect(trace.requestedAt).toBeDefined();
    expect(trace.governanceCompletedAt).toBeDefined();
    expect(trace.executionStartedAt).toBeDefined();
    expect(trace.completedAt).toBeDefined();
  });

  it("persists WorkTrace with deny outcome on governance deny", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
      riskTolerance: {
        none: "none" as const,
        low: "none" as const,
        medium: "standard" as const,
        high: "elevated" as const,
        critical: "mandatory" as const,
      },
      globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: ["digital-ads.budget.adjust"],
      trustBehaviors: [],
      delegatedApprovers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const traces: WorkTrace[] = [];
    const mockTraceStore = {
      persist: vi.fn(async (trace: WorkTrace) => {
        traces.push(trace);
      }),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app.platformIngress as any).config.traceStore = mockTraceStore;

    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "Idempotency-Key": "parity-deny-trace-key" },
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        action: {
          actionType: "digital-ads.budget.adjust",
          parameters: { amount: 1000 },
          sideEffect: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockTraceStore.persist).toHaveBeenCalledOnce();
    const trace = traces[0]!;
    expect(trace.governanceOutcome).toBe("deny");
    expect(trace.outcome).toBe("failed");
    expect(trace.executionStartedAt).toBeUndefined();
  });

  // --- Parity criterion 10: Client-supplied traceId passthrough ---
  it("echoes client-supplied traceId in response", async () => {
    await app.storageContext.identity.saveSpec({
      id: "spec_default",
      principalId: "default",
      organizationId: null,
      name: "Default User",
      description: "Parity test spec",
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

    const clientTraceId = "client-trace-abc-123";
    const res = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "Idempotency-Key": "parity-clienttrace-key" },
      payload: {
        actorId: "default",
        organizationId: ORG_ID,
        traceId: clientTraceId,
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_clienttrace" },
          sideEffect: true,
        },
      },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.traceId).toBe(clientTraceId);
  });
});
