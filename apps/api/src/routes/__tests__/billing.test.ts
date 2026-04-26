import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Stripe SDK — vi.hoisted ensures fns are available before vi.mock runs
// ---------------------------------------------------------------------------

const { mockCheckoutCreate, mockPortalCreate, mockConstructEvent } = vi.hoisted(() => ({
  mockCheckoutCreate: vi.fn(),
  mockPortalCreate: vi.fn(),
  mockConstructEvent: vi.fn(),
}));

vi.mock("stripe", () => {
  const StripeMock = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockCheckoutCreate } },
    billingPortal: { sessions: { create: mockPortalCreate } },
    webhooks: { constructEvent: mockConstructEvent },
  }));
  return { default: StripeMock };
});

// ---------------------------------------------------------------------------
// Mock Prisma (inline — avoids needing a real DB)
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

const mockPrisma = {
  organizationConfig: {
    findUnique: mockFindUnique,
    update: mockUpdate,
  },
};

// ---------------------------------------------------------------------------
// Build a minimal Fastify app with billing routes
// ---------------------------------------------------------------------------

import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { billingRoutes } from "../billing.js";

async function buildTestApp() {
  const app = Fastify();

  // Register raw body plugin (mirrors app.ts — needed for webhook signature verification)
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  // Simulate auth middleware setting organizationIdFromAuth
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.addHook("onRequest", async (request) => {
    const authHeader = request.headers["x-org-id"];
    if (typeof authHeader === "string") {
      request.organizationIdFromAuth = authHeader;
    }
  });

  app.decorate("prisma", mockPrisma as unknown as typeof app.prisma);
  await app.register(billingRoutes, { prefix: "/api/billing" });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("billing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  });

  // ── POST /api/billing/checkout ──────────────────────────────────────────

  it("POST /checkout creates session and returns URL", async () => {
    mockCheckoutCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session-123" });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: {
        email: "owner@example.com",
        priceId: "price_starter",
        successUrl: "https://app.test/success",
        cancelUrl: "https://app.test/cancel",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.url).toBe("https://checkout.stripe.com/session-123");
    expect(mockCheckoutCreate).toHaveBeenCalledOnce();
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: "owner@example.com",
        mode: "subscription",
        metadata: { organizationId: "org-1" },
      }),
    );
  });

  it("POST /checkout returns 400 when fields missing", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: { email: "owner@example.com" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /checkout returns 403 without org scope", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers: { "content-type": "application/json" },
      payload: {
        email: "owner@example.com",
        priceId: "price_starter",
        successUrl: "https://app.test/success",
        cancelUrl: "https://app.test/cancel",
      },
    });

    expect(res.statusCode).toBe(403);
  });

  // ── POST /api/billing/portal ────────────────────────────────────────────

  it("POST /portal returns portal URL", async () => {
    mockFindUnique.mockResolvedValue({ stripeCustomerId: "cus_abc123" });
    mockPortalCreate.mockResolvedValue({ url: "https://billing.stripe.com/portal-123" });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/portal",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: { returnUrl: "https://app.test/settings" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.url).toBe("https://billing.stripe.com/portal-123");
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: "cus_abc123",
      return_url: "https://app.test/settings",
    });
  });

  it("POST /portal returns 400 when no Stripe customer", async () => {
    mockFindUnique.mockResolvedValue({ stripeCustomerId: null });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/portal",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: { returnUrl: "https://app.test/settings" },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── GET /api/billing/status ─────────────────────────────────────────────

  it("GET /status returns billing status", async () => {
    mockFindUnique.mockResolvedValue({
      subscriptionStatus: "active",
      stripePriceId: "price_pro",
      trialEndsAt: new Date("2026-05-24T00:00:00Z"),
      currentPeriodEnd: new Date("2026-06-24T00:00:00Z"),
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/billing/status",
      headers: { "x-org-id": "org-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.subscriptionStatus).toBe("active");
    expect(body.currentPlan).toBe("price_pro");
    expect(body.trialEndsAt).toBe("2026-05-24T00:00:00.000Z");
    expect(body.currentPeriodEnd).toBe("2026-06-24T00:00:00.000Z");
  });

  it("GET /status returns 404 when org not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/billing/status",
      headers: { "x-org-id": "org-unknown" },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── POST /api/billing/webhook ───────────────────────────────────────────

  it("webhook handles checkout.session.completed", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { organizationId: "org-1" },
          customer: "cus_new",
          subscription: "sub_new",
        },
      },
    });
    mockUpdate.mockResolvedValue({});

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: {
        "stripe-signature": "sig_valid",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ id: "evt_1" }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ received: true });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        stripeCustomerId: "cus_new",
        stripeSubscriptionId: "sub_new",
        subscriptionStatus: "trialing",
      },
    });
  });

  it("webhook handles customer.subscription.updated", async () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          metadata: { organizationId: "org-1" },
          status: "active",
          items: { data: [{ price: { id: "price_pro" }, current_period_end: 1787875200 }] },
          cancel_at_period_end: false,
          trial_end: null,
        },
      },
    });
    mockUpdate.mockResolvedValue({});

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: {
        "stripe-signature": "sig_valid",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ id: "evt_2" }),
    });

    expect(res.statusCode).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: expect.objectContaining({
          subscriptionStatus: "active",
          stripePriceId: "price_pro",
        }),
      }),
    );
  });

  it("webhook returns 400 for invalid signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: {
        "stripe-signature": "sig_invalid",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ id: "evt_bad" }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("Invalid webhook signature");
  });

  it("webhook returns 400 when stripe-signature header missing", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: "evt_no_sig" }),
    });

    expect(res.statusCode).toBe(400);
  });
});
