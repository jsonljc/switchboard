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

    it("forwards payload.kind/body/quote/quoteFrom when present (A.7c)", async () => {
      // Seed an approval directly via the in-memory store with a typed payload.
      const now = new Date();
      const futureDate = new Date(now.getTime() + 60 * 60 * 1000);
      await app.storageContext.approvals.save({
        request: {
          id: "appr_reg",
          actionId: "act_reg",
          envelopeId: "env_reg",
          conversationId: null,
          summary: "Regulatory review required",
          riskCategory: "critical",
          bindingHash: "h-reg",
          evidenceBundle: {
            decisionTrace: null,
            contextSnapshot: {},
            identitySnapshot: {},
          },
          suggestedButtons: [{ label: "Approve", action: "approve" }],
          approvers: ["reviewer_1"],
          fallbackApprover: null,
          status: "pending",
          respondedBy: null,
          respondedAt: null,
          patchValue: null,
          expiresAt: futureDate,
          expiredBehavior: "deny",
          createdAt: now,
          quorum: null,
          payload: {
            kind: "regulatory",
            body: "Patient asked about FDA approval status.",
            quote: "Our laser treatment is FDA approved.",
            quoteFrom: "Alex (draft)",
          },
        },
        state: {
          status: "pending",
          expiresAt: futureDate,
          respondedAt: null,
          respondedBy: null,
          patchValue: null,
          quorum: null,
          version: 1,
        },
        envelopeId: "env_reg",
        organizationId: "default",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/pending",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const regulatory = body.approvals.find((a: { id: string }) => a.id === "appr_reg");
      expect(regulatory).toBeDefined();
      expect(regulatory.kind).toBe("regulatory");
      expect(regulatory.body).toBe("Patient asked about FDA approval status.");
      expect(regulatory.quote).toBe("Our laser treatment is FDA approved.");
      expect(regulatory.quoteFrom).toBe("Alex (draft)");
    });

    it("omits kind/body when payload absent (legacy approval)", async () => {
      // Seed a legacy approval (no payload).
      const now = new Date();
      const futureDate = new Date(now.getTime() + 60 * 60 * 1000);
      await app.storageContext.approvals.save({
        request: {
          id: "appr_legacy",
          actionId: "act_legacy",
          envelopeId: "env_legacy",
          conversationId: null,
          summary: "Pricing change",
          riskCategory: "medium",
          bindingHash: "h-leg",
          evidenceBundle: {
            decisionTrace: null,
            contextSnapshot: {},
            identitySnapshot: {},
          },
          suggestedButtons: [{ label: "Approve", action: "approve" }],
          approvers: ["reviewer_1"],
          fallbackApprover: null,
          status: "pending",
          respondedBy: null,
          respondedAt: null,
          patchValue: null,
          expiresAt: futureDate,
          expiredBehavior: "deny",
          createdAt: now,
          quorum: null,
        },
        state: {
          status: "pending",
          expiresAt: futureDate,
          respondedAt: null,
          respondedBy: null,
          patchValue: null,
          quorum: null,
          version: 1,
        },
        envelopeId: "env_legacy",
        organizationId: "default",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/pending",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const legacy = body.approvals.find((a: { id: string }) => a.id === "appr_legacy");
      expect(legacy).toBeDefined();
      expect(legacy.kind).toBeUndefined();
      expect(legacy.body).toBeUndefined();
      expect(legacy.quote).toBeUndefined();
      expect(legacy.quoteFrom).toBeUndefined();
    });
  });
});
