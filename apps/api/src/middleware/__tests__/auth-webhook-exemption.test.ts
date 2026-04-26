import { describe, it, expect } from "vitest";

/**
 * Verifies that the auth middleware exclusion list includes the billing webhook path.
 * This is a P0 fix — Stripe webhooks were getting 401 because the path was not exempted.
 */
describe("auth middleware webhook exemption", () => {
  it("allows /api/billing/webhook without auth", async () => {
    const { default: Fastify } = await import("fastify");
    const { authMiddleware } = await import("../auth.js");

    const app = Fastify();
    const origKeys = process.env["API_KEYS"];
    process.env["API_KEYS"] = "test-key-12345";

    try {
      await app.register(authMiddleware);
      app.post("/api/billing/webhook", async () => ({ received: true }));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        payload: { test: true },
      });

      // Should NOT get 401 — webhook path is exempted from auth
      expect(res.statusCode).not.toBe(401);
    } finally {
      process.env["API_KEYS"] = origKeys;
      await app.close();
    }
  });

  it("allows /api/leads/inbound/:token without auth (form tools authenticate via path token)", async () => {
    const { default: Fastify } = await import("fastify");
    const { authMiddleware } = await import("../auth.js");

    const app = Fastify();
    const origKeys = process.env["API_KEYS"];
    process.env["API_KEYS"] = "test-key-12345";

    try {
      await app.register(authMiddleware);
      app.post("/api/leads/inbound/:token", async () => ({ received: true }));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/leads/inbound/whk_anything",
        payload: { test: true },
      });

      expect(res.statusCode).not.toBe(401);
    } finally {
      process.env["API_KEYS"] = origKeys;
      await app.close();
    }
  });

  it("blocks unauthenticated requests to non-exempt paths", async () => {
    const { default: Fastify } = await import("fastify");
    const { authMiddleware } = await import("../auth.js");

    const app = Fastify();
    const origKeys = process.env["API_KEYS"];
    process.env["API_KEYS"] = "test-key-12345";

    try {
      await app.register(authMiddleware);
      app.get("/api/billing/status", async () => ({ ok: true }));
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/api/billing/status",
      });

      expect(res.statusCode).toBe(401);
    } finally {
      process.env["API_KEYS"] = origKeys;
      await app.close();
    }
  });
});
