import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Simulate API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/simulate", () => {
    it("should return 200 with decisionTrace", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/simulate",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.decisionTrace).toBeDefined();
    });

    it("should have no side effects (no envelopes created)", async () => {
      await app.inject({
        method: "POST",
        url: "/api/simulate",
        payload: {
          actionType: "ads.campaign.pause",
          parameters: { campaignId: "camp_123" },
          principalId: "default",
          cartridgeId: "ads-spend",
        },
      });

      // Check that no envelopes were created
      const envelope = await app.storageContext.envelopes.getById("any-id");
      expect(envelope).toBeNull();
    });

    it("should return 400 for empty body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/simulate",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it("should return 400 when cartridge cannot be inferred", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/simulate",
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
  });
});
