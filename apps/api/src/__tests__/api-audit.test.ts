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

  /** Helper: propose an action to generate audit entries */
  async function proposeAction() {
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
    return res.json();
  }

  describe("GET /api/audit", () => {
    it("should return audit entries after a proposal", async () => {
      await proposeAction();

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
      await proposeAction();

      const res = await app.inject({
        method: "GET",
        url: "/api/audit?eventType=action.proposed",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const entry of body.entries) {
        expect(entry.eventType).toBe("action.proposed");
      }
    });
  });

  describe("GET /api/audit/verify", () => {
    it("should verify chain integrity as valid after normal operations", async () => {
      await proposeAction();
      await proposeAction();

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
      await proposeAction();

      // Get all entries first
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
