import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { TestCartridge } from "@switchboard/cartridge-sdk";

describe("Actions API", () => {
  let app: FastifyInstance;
  let cartridge: TestCartridge;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
    cartridge = ctx.cartridge;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/actions/propose", () => {
    it("should return 201 with envelope, decisionTrace, and approvalRequest", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.envelope).toBeDefined();
      expect(body.decisionTrace).toBeDefined();
      expect(body.envelope.id).toBeDefined();
      expect(body.envelope.status).toBeDefined();
    });

    it("should return 400 when cartridgeId is missing and cannot be inferred", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "unknown.action",
          parameters: {},
          principalId: "default",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("cartridgeId");
    });

    it("should return 201 with denied status for forbidden behavior", async () => {
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
        forbiddenBehaviors: ["ads.campaign.pause"],
        trustBehaviors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.denied).toBe(true);
      expect(body.envelope.status).toBe("denied");
    });
  });

  describe("GET /api/actions/:id", () => {
    it("should return 200 with envelope after propose", async () => {
      // First propose an action
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });
      const envelopeId = proposeRes.json().envelope.id;

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
    it("should return 200 after executing an approved envelope", async () => {
      // Use low risk to get auto-approved
      cartridge.onRiskInput(() => ({
        baseRisk: "low" as const,
        exposure: { dollarsAtRisk: 10, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      expect(proposeRes.json().envelope.status).toBe("approved");
      const envelopeId = proposeRes.json().envelope.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/actions/${envelopeId}/execute`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.result.success).toBe(true);
    });

    it("should return 400 when executing a non-approved envelope", async () => {
      // Default risk is high → needs approval → status is pending_approval
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      const envelopeId = proposeRes.json().envelope.id;

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
      // Low risk → auto-approved
      cartridge.onRiskInput(() => ({
        baseRisk: "low" as const,
        exposure: { dollarsAtRisk: 10, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      // Propose and execute
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });
      const envelopeId = proposeRes.json().envelope.id;

      await app.inject({
        method: "POST",
        url: `/api/actions/${envelopeId}/execute`,
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

    it("should return 400 for non-existent envelope", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/non-existent-id/undo",
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/actions/batch", () => {
    it("should return 201 with results for each proposal", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/batch",
        payload: {
          proposals: [
            { actionType: "ads.campaign.pause", parameters: { campaignId: "camp_1" } },
            { actionType: "ads.campaign.pause", parameters: { campaignId: "camp_2" } },
          ],
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.results).toHaveLength(2);
    });
  });
});
