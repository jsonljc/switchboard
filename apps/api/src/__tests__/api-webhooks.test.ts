import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { webhooksRoutes } from "../routes/webhooks.js";

describe("Webhooks API", () => {
  let app: FastifyInstance;

  const mockIdentity = {
    getPrincipal: vi.fn().mockResolvedValue({ roles: ["admin"] }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("storageContext", { identity: mockIdentity } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.decorateRequest("principalIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
      request.principalIdFromAuth = "user_admin";
    });

    await app.register(webhooksRoutes, { prefix: "/api/webhooks" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/webhooks", () => {
    it("lists registered webhooks", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/webhooks",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().webhooks).toBeInstanceOf(Array);
    });
  });

  describe("POST /api/webhooks", () => {
    it("creates a webhook with HTTPS URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        payload: {
          url: "https://example.com/webhook",
          events: ["action.executed"],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.url).toBe("https://example.com/webhook");
      expect(body.secret).toBeDefined();
      expect(body.active).toBe(true);
    });

    it("rejects non-HTTPS URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        payload: {
          url: "http://example.com/webhook",
          events: ["action.executed"],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("HTTPS");
    });

    it("returns 403 for unauthorized role", async () => {
      mockIdentity.getPrincipal.mockResolvedValueOnce({ roles: ["viewer"] });

      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        payload: {
          url: "https://example.com/webhook",
          events: ["action.executed"],
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("DELETE /api/webhooks/:id", () => {
    it("deletes a webhook", async () => {
      // First create one
      const createRes = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        payload: {
          url: "https://example.com/wh2",
          events: ["test"],
        },
      });
      const webhookId = createRes.json().id;

      const res = await app.inject({
        method: "DELETE",
        url: `/api/webhooks/${webhookId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });

    it("returns 404 for unknown webhook", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/webhooks/wh_nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/webhooks/:id/test", () => {
    it("sends test payload to webhook endpoint", async () => {
      // Create a webhook
      const createRes = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        payload: {
          url: "https://example.com/wh3",
          events: ["test"],
        },
      });
      const webhookId = createRes.json().id;

      // Mock global fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const res = await app.inject({
        method: "POST",
        url: `/api/webhooks/${webhookId}/test`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().statusCode).toBe(200);

      globalThis.fetch = originalFetch;
    });

    it("handles fetch failure gracefully", async () => {
      // Create a webhook
      const createRes = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        payload: {
          url: "https://example.com/wh4",
          events: ["test"],
        },
      });
      const webhookId = createRes.json().id;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const res = await app.inject({
        method: "POST",
        url: `/api/webhooks/${webhookId}/test`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(false);
      expect(res.json().error).toContain("Connection refused");

      globalThis.fetch = originalFetch;
    });
  });
});
