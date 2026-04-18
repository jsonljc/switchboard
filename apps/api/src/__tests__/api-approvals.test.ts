import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Approvals API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;

    // Override risk tolerance so medium-risk actions require approval
    const spec = await app.storageContext.identity.getSpecByPrincipalId("default");
    if (spec) {
      spec.riskTolerance = {
        ...spec.riskTolerance,
        medium: "standard" as const,
        high: "elevated" as const,
        critical: "mandatory" as const,
      };
      await app.storageContext.identity.saveSpec(spec);
    }
  });

  afterEach(async () => {
    await app.close();
  });

  /** Helper: propose an action that requires approval (default high risk → medium category → standard approval) */
  async function proposeWithApproval() {
    const res = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "Idempotency-Key": `test-approval-${Date.now()}-${Math.random()}` },
      payload: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_123" },
        principalId: "default",
        cartridgeId: "digital-ads",
        organizationId: "default",
      },
    });
    const body = res.json();
    return {
      envelopeId: body.workUnitId as string,
      approvalRequest: body.approvalRequest as {
        id: string;
        bindingHash: string;
      },
    };
  }

  describe("POST /api/approvals/:id/respond", () => {
    it("should approve with correct bindingHash and return executionResult", async () => {
      const { approvalRequest } = await proposeWithApproval();
      expect(approvalRequest).toBeDefined();

      const res = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalRequest.id}/respond`,
        payload: {
          action: "approve",
          respondedBy: "reviewer_1",
          bindingHash: approvalRequest.bindingHash,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.executionResult).toBeDefined();
      expect(body.executionResult.success).toBe(true);
      expect(body.approvalState.status).toBe("approved");
    });

    it("should reject and mark approval as rejected", async () => {
      const { approvalRequest } = await proposeWithApproval();

      const res = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalRequest.id}/respond`,
        payload: {
          action: "reject",
          respondedBy: "reviewer_1",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approvalState.status).toBe("rejected");
      expect(body.executionResult).toBeNull();
    });

    it("should return 400 with wrong bindingHash", async () => {
      const { approvalRequest } = await proposeWithApproval();

      const res = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalRequest.id}/respond`,
        payload: {
          action: "approve",
          respondedBy: "reviewer_1",
          bindingHash: "wrong-hash",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("stale");
    });

    it("should return 400 for invalid body (missing action)", async () => {
      const { approvalRequest } = await proposeWithApproval();

      const res = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalRequest.id}/respond`,
        payload: {
          respondedBy: "reviewer_1",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it("should return 400 for invalid action value", async () => {
      const { approvalRequest } = await proposeWithApproval();

      const res = await app.inject({
        method: "POST",
        url: `/api/approvals/${approvalRequest.id}/respond`,
        payload: {
          action: "invalid_action",
          respondedBy: "reviewer_1",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it("should return 404 for non-existent approval", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/approvals/non-existent-id/respond",
        payload: {
          action: "approve",
          respondedBy: "reviewer_1",
          bindingHash: "some-hash",
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/approvals/pending", () => {
    it("should list pending approvals after a medium-risk proposal", async () => {
      await proposeWithApproval();

      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/pending",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approvals.length).toBeGreaterThanOrEqual(1);
      expect(body.approvals[0].status).toBe("pending");
    });
  });

  describe("GET /api/approvals/:id", () => {
    it("should return 200 with approval details", async () => {
      const { approvalRequest } = await proposeWithApproval();

      const res = await app.inject({
        method: "GET",
        url: `/api/approvals/${approvalRequest.id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.request).toBeDefined();
      expect(body.state).toBeDefined();
      expect(body.envelopeId).toBeDefined();
    });

    it("should return 404 for non-existent approval", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
