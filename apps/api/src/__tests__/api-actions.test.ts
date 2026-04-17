import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Actions API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/actions/propose", () => {
    it("should return 201 with outcome, envelopeId, and traceId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-propose-1",
        },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.outcome).toBeDefined();
      expect(body.envelopeId).toBeDefined();
      expect(body.traceId).toBeDefined();
    });

    it("should return 404 for unknown action type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-propose-2",
        },
        payload: {
          actionType: "unknown.action",
          parameters: {},
          principalId: "default",
          organizationId: "org_test",
        },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
    });

    it("should return 201 with DENIED outcome for forbidden behavior", async () => {
      // Update identity spec to forbid this action
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
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-propose-3",
        },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.outcome).toBe("DENIED");
      expect(body.denied).toBe(true);
    });

    it("should return 400 for empty body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-propose-4",
        },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
    });

    it("should return 400 when principalId is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-propose-5",
        },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it("returns 400 when Idempotency-Key header is missing on propose", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          organizationId: "org_test",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Idempotency-Key");
    });
  });

  describe("GET /api/actions/:id", () => {
    it("should return 200 with envelope after propose", async () => {
      // First propose an action
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-get-1",
        },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });
      const proposeBody = proposeRes.json();
      const envelopeId = proposeBody.envelopeId;

      const res = await app.inject({
        method: "GET",
        url: `/api/actions/${envelopeId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().envelope.id).toBe(envelopeId);
    });

    it("should return 404 for non-existent envelope", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/actions/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/actions/:id/execute", () => {
    it.skip("should execute a pending approval envelope", async () => {
      // Default risk is high → pending approval
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-execute-1",
        },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      const proposeBody = proposeRes.json();
      expect(proposeBody.outcome).toBe("PENDING_APPROVAL");
      const envelopeId = proposeBody.envelopeId;

      // Approve the envelope first
      const envelope = await app.storageContext.envelopes.getById(envelopeId);
      if (envelope) {
        await app.storageContext.envelopes.update(envelopeId, { status: "approved" });
      }

      // Now execute it
      const res = await app.inject({
        method: "POST",
        url: `/api/actions/${envelopeId}/execute`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.result.success).toBe(true);
    });

    it.skip("should return 400 when executing a non-approved envelope", async () => {
      // Default risk is high → needs approval → status is pending_approval
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: {
          "Idempotency-Key": "test-execute-2",
        },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      const envelopeId = proposeRes.json().envelopeId;

      const res = await app.inject({
        method: "POST",
        url: `/api/actions/${envelopeId}/execute`,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe("POST /api/actions/:id/undo", () => {
    it("should return 201 with new proposal after undoing executed envelope", async () => {
      // First create and execute an envelope via the old orchestrator path
      // (since propose+execute are combined in the new platform path)
      const envelopeId = `env_undo_test`;
      const proposalId = `prop_undo_test`;

      // Create envelope with execution result
      const now = new Date();
      await app.storageContext.envelopes.save({
        id: envelopeId,
        version: 1,
        incomingMessage: null,
        conversationId: null,
        proposals: [
          {
            id: proposalId,
            actionType: "digital-ads.campaign.pause",
            parameters: {
              campaignId: "camp_123",
              _principalId: "default",
              _cartridgeId: "digital-ads",
            },
            evidence: "Test envelope for undo",
            confidence: 1.0,
            originatingMessageId: "",
          },
        ],
        resolvedEntities: [],
        plan: null,
        decisions: [
          {
            actionId: proposalId,
            envelopeId,
            checks: [],
            computedRiskScore: { rawScore: 0, category: "none", factors: [] },
            finalDecision: "allow",
            approvalRequired: "none",
            explanation: "Test",
            evaluatedAt: now,
          },
        ],
        approvalRequests: [],
        executionResults: [
          {
            actionId: proposalId,
            envelopeId,
            success: true,
            summary: "Executed",
            externalRefs: { campaignId: "camp_123" },
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 15,
            undoRecipe: {
              originalActionId: "digital-ads.campaign.pause",
              originalEnvelopeId: envelopeId,
              reverseActionType: "digital-ads.campaign.resume",
              reverseParameters: { campaignId: "camp_123" },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "none",
            },
            executedAt: now,
          },
        ],
        auditEntryIds: [],
        status: "executed",
        createdAt: now,
        updatedAt: now,
        parentEnvelopeId: null,
        traceId: "trace_undo_test",
      });

      // Now undo
      const undoRes = await app.inject({
        method: "POST",
        url: `/api/actions/${envelopeId}/undo`,
      });

      expect(undoRes.statusCode).toBe(201);
      const body = undoRes.json();
      expect(body.envelope).toBeDefined();
      expect(body.envelope.parentEnvelopeId).toBe(envelopeId);
    });

    it("should return 404 for non-existent envelope", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/non-existent-id/undo",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/actions/batch", () => {
    it("should return 201 with results for each proposal", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/batch",
        headers: {
          "Idempotency-Key": "test-batch-1",
        },
        payload: {
          proposals: [
            { actionType: "digital-ads.campaign.pause", parameters: { campaignId: "camp_1" } },
            { actionType: "digital-ads.campaign.pause", parameters: { campaignId: "camp_2" } },
          ],
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.results).toHaveLength(2);
      expect(body.results[0].outcome).toBeDefined();
      expect(body.results[0].envelopeId).toBeDefined();
    });

    it("returns 400 when Idempotency-Key header is missing on batch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/batch",
        payload: {
          proposals: [
            { actionType: "digital-ads.campaign.pause", parameters: { campaignId: "camp_1" } },
          ],
          principalId: "default",
          organizationId: "org_test",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Idempotency-Key");
    });
  });
});
