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

  it("allows the OAuth provider callbacks without auth (signed-state verified in-route)", async () => {
    const { default: Fastify } = await import("fastify");
    const { authMiddleware } = await import("../auth.js");

    const app = Fastify();
    const origKeys = process.env["API_KEYS"];
    process.env["API_KEYS"] = "test-key-12345";

    try {
      await app.register(authMiddleware);
      app.get("/api/connections/facebook/callback", async () => ({ ok: true }));
      app.get("/api/connections/google-calendar/callback", async () => ({ ok: true }));
      await app.ready();

      // Facebook/Google control these redirects, so they carry no Bearer. They must be reachable;
      // the route itself rejects a forged/expired signed `state`.
      const fb = await app.inject({
        method: "GET",
        url: "/api/connections/facebook/callback?code=x&state=y",
      });
      const gcal = await app.inject({
        method: "GET",
        url: "/api/connections/google-calendar/callback?code=x&state=y",
      });

      expect(fb.statusCode).not.toBe(401);
      expect(gcal.statusCode).not.toBe(401);
    } finally {
      process.env["API_KEYS"] = origKeys;
      await app.close();
    }
  });

  it("keeps the OAuth authorize legs Bearer-authed (NOT exempt)", async () => {
    const { default: Fastify } = await import("fastify");
    const { authMiddleware } = await import("../auth.js");

    const app = Fastify();
    const origKeys = process.env["API_KEYS"];
    process.env["API_KEYS"] = "test-key-12345";

    try {
      await app.register(authMiddleware);
      app.get("/api/connections/facebook/authorize", async () => ({ ok: true }));
      app.get("/api/connections/google-calendar/authorize", async () => ({ ok: true }));
      await app.ready();

      // The authorize/minting legs must stay authed so assertOrgAccess can run; an exempt,
      // self-signing authorize leg would be a state-minting oracle (connection-fixation).
      const fb = await app.inject({
        method: "GET",
        url: "/api/connections/facebook/authorize?deploymentId=d",
      });
      const gcal = await app.inject({
        method: "GET",
        url: "/api/connections/google-calendar/authorize?deploymentId=d",
      });

      expect(fb.statusCode).toBe(401);
      expect(gcal.statusCode).toBe(401);
    } finally {
      process.env["API_KEYS"] = origKeys;
      await app.close();
    }
  });
});
