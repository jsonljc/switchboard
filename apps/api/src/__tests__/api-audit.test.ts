import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Audit API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  async function proposeWithApprovalAndRespond() {
    const spec = await app.storageContext.identity.getSpecByPrincipalId("default");
    if (spec) {
      spec.riskTolerance = {
        ...spec.riskTolerance,
        medium: "standard" as const,
        high: "elevated" as const,
      };
      await app.storageContext.identity.saveSpec(spec);
    }

    const proposeRes = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "Idempotency-Key": `test-audit-${Date.now()}-${Math.random()}` },
      payload: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_123" },
        principalId: "default",
        cartridgeId: "digital-ads",
        organizationId: "default",
      },
    });

    const body = proposeRes.json();
    if (body.outcome === "PENDING_APPROVAL" && body.approvalRequest) {
      await app.inject({
        method: "POST",
        url: `/api/approvals/${body.approvalRequest.id}/respond`,
        payload: {
          action: "approve",
          respondedBy: "reviewer_1",
          bindingHash: body.approvalRequest.bindingHash,
        },
      });
    }

    return body;
  }

  describe("GET /api/audit", () => {
    it("should return audit entries after approval lifecycle", async () => {
      await proposeWithApprovalAndRespond();

      const res = await app.inject({
        method: "GET",
        url: "/api/audit",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries.length).toBeGreaterThanOrEqual(1);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it("should filter by eventType", async () => {
      await proposeWithApprovalAndRespond();

      const res = await app.inject({
        method: "GET",
        url: "/api/audit?eventType=action.approved",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const entry of body.entries) {
        expect(entry.eventType).toBe("action.approved");
      }
    });
  });

  describe("GET /api/audit/verify", () => {
    it("should verify chain integrity as valid after normal operations", async () => {
      await proposeWithApprovalAndRespond();
      await proposeWithApprovalAndRespond();

      const res = await app.inject({
        method: "GET",
        url: "/api/audit/verify",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(true);
      expect(body.entriesChecked).toBeGreaterThanOrEqual(2);
    });
  });

  describe("GET /api/audit/:id", () => {
    it("should return a specific audit entry", async () => {
      await proposeWithApprovalAndRespond();

      const listRes = await app.inject({
        method: "GET",
        url: "/api/audit",
      });
      const entryId = listRes.json().entries[0].id;

      const res = await app.inject({
        method: "GET",
        url: `/api/audit/${entryId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().entry.id).toBe(entryId);
    });

    it("should return 404 for non-existent entry", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/audit/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
