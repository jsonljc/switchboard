import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../require-role.js";

/**
 * Builds an isolated Fastify app whose POST /admin route is gated by
 * requireRole(..., "admin"). The identity store's getPrincipal is mocked and
 * auth state (authDisabled, principalIdFromAuth) is injected per test.
 */
function buildApp(opts: {
  authDisabled: boolean;
  principalId?: string;
  principal?: { roles: string[] } | null;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", opts.authDisabled);
  const getPrincipal = vi.fn().mockResolvedValue(opts.principal ?? null);
  app.decorate("storageContext", { identity: { getPrincipal } } as unknown as never);
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);
  app.addHook("onRequest", async (request) => {
    request.organizationIdFromAuth = "org_test";
    request.principalIdFromAuth = opts.principalId;
  });
  app.post("/admin", async (request, reply) => {
    if (!(await requireRole(request, reply, "admin"))) return;
    return { ok: true };
  });
  return app;
}

describe("requireRole", () => {
  it("fails closed with 403 when auth is enabled but no principal is bound", async () => {
    // Regression: an org-scoped static API key with an empty principal part
    // (key:org_acme::) sets organizationIdFromAuth but leaves principalIdFromAuth
    // undefined. Such a key must NOT pass admin role gates.
    const app = buildApp({ authDisabled: false, principalId: undefined });
    const res = await app.inject({ method: "POST", url: "/admin", payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows when auth is enabled and the principal has a required role", async () => {
    const app = buildApp({
      authDisabled: false,
      principalId: "user_admin",
      principal: { roles: ["admin"] },
    });
    const res = await app.inject({ method: "POST", url: "/admin", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("denies with 403 when the principal lacks the required role", async () => {
    const app = buildApp({
      authDisabled: false,
      principalId: "user_viewer",
      principal: { roles: ["viewer"] },
    });
    const res = await app.inject({ method: "POST", url: "/admin", payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows all in dev mode (authDisabled) even without a principal", async () => {
    const app = buildApp({ authDisabled: true, principalId: undefined });
    const res = await app.inject({ method: "POST", url: "/admin", payload: {} });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
