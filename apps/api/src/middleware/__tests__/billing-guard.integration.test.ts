import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { billingGuard } from "../billing-guard.js";
import type {
  BillingEntitlementResolver,
  OrganizationEntitlement,
} from "@switchboard/core/billing";

function makeResolver(map: Record<string, OrganizationEntitlement>): BillingEntitlementResolver {
  return {
    resolve: async (orgId: string) =>
      map[orgId] ?? { entitled: false, reason: "blocked", blockedStatus: "missing" },
  };
}

async function makeApp(
  resolver: BillingEntitlementResolver,
  orgId = "org_test",
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("billingEntitlementResolver", resolver);

  // Stub auth — set request.organizationIdFromAuth before billingGuard runs.
  app.addHook("onRequest", async (req) => {
    req.organizationIdFromAuth = orgId;
  });

  await app.register(billingGuard);

  // Routes spanning mutating + read + allowlisted.
  app.post("/api/actions/propose", async () => ({ ok: true }));
  app.get("/api/actions/list", async () => ({ ok: true }));
  app.post("/api/billing/checkout", async () => ({ ok: true }));
  app.post("/api/setup/start", async () => ({ ok: true }));
  app.post("/api/webhooks/stripe", async () => ({ ok: true }));
  app.delete("/api/agents/foo", async () => ({ ok: true }));
  app.get("/health", async () => ({ ok: true }));

  return app;
}

describe("billingGuard integration", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("rejects POST from canceled org with 402", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      error: "Active subscription required",
      statusCode: 402,
      blockedStatus: "canceled",
    });
  });

  it("rejects POST from past_due org with 402", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "past_due" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
    expect(res.statusCode).toBe(402);
    expect(res.json().blockedStatus).toBe("past_due");
  });

  it("rejects POST from incomplete org with 402 (no grace)", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "incomplete" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
    expect(res.statusCode).toBe(402);
  });

  it("rejects DELETE from canceled org with 402", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "DELETE", url: "/api/agents/foo" });
    expect(res.statusCode).toBe(402);
  });

  it("allows POST from active org", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: true, reason: "active" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("allows POST from trialing org", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: true, reason: "trialing" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
    expect(res.statusCode).toBe(200);
  });

  it("allows POST from override org regardless of subscription state", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: true, reason: "override" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
    expect(res.statusCode).toBe(200);
  });

  it("allows GET from canceled org (read-only bypass)", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/actions/list" });
    expect(res.statusCode).toBe(200);
  });

  it("allows POST /api/billing/checkout from canceled org (must reach Stripe)", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/billing/checkout" });
    expect(res.statusCode).toBe(200);
  });

  it("allows POST /api/setup/start from canceled org (onboarding pre-subscription)", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/setup/start" });
    expect(res.statusCode).toBe(200);
  });

  it("allows POST /api/webhooks/stripe from any org (signed webhook)", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/webhooks/stripe" });
    expect(res.statusCode).toBe(200);
  });

  it("allows GET /health regardless of org status", async () => {
    app = await makeApp(
      makeResolver({
        org_test: { entitled: false, reason: "blocked", blockedStatus: "canceled" },
      }),
    );
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});
