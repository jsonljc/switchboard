import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { inboundWebhooksRoutes } from "../routes/inbound-webhooks.js";

function buildStripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("Inbound Webhooks API", () => {
  let app: FastifyInstance;
  let savedStripeSecret: string | undefined;
  let savedFbAppSecret: string | undefined;
  let savedFbVerifyToken: string | undefined;

  const mockCartridges = {
    get: vi.fn(),
    list: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    savedStripeSecret = process.env["STRIPE_WEBHOOK_SECRET"];
    savedFbAppSecret = process.env["FACEBOOK_APP_SECRET"];
    savedFbVerifyToken = process.env["FACEBOOK_VERIFY_TOKEN"];

    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test";
    process.env["FACEBOOK_APP_SECRET"] = "fb_app_secret_test";
    process.env["FACEBOOK_VERIFY_TOKEN"] = "fb_verify_test";

    app = Fastify({ logger: false });

    app.decorate("storageContext", { cartridges: mockCartridges } as any);

    await app.register(inboundWebhooksRoutes, { prefix: "/api/inbound" });
  });

  afterEach(async () => {
    await app.close();

    if (savedStripeSecret !== undefined) process.env["STRIPE_WEBHOOK_SECRET"] = savedStripeSecret;
    else delete process.env["STRIPE_WEBHOOK_SECRET"];

    if (savedFbAppSecret !== undefined) process.env["FACEBOOK_APP_SECRET"] = savedFbAppSecret;
    else delete process.env["FACEBOOK_APP_SECRET"];

    if (savedFbVerifyToken !== undefined) process.env["FACEBOOK_VERIFY_TOKEN"] = savedFbVerifyToken;
    else delete process.env["FACEBOOK_VERIFY_TOKEN"];
  });

  describe("POST /api/inbound/stripe", () => {
    it("returns 400 when Stripe-Signature header is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/stripe",
        payload: { id: "evt_1", type: "test" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Missing");
    });

    it("returns 500 when webhook secret is not configured", async () => {
      delete process.env["STRIPE_WEBHOOK_SECRET"];

      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/stripe",
        headers: { "stripe-signature": "t=123,v1=abc" },
        payload: { id: "evt_1", type: "test" },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain("not configured");
    });

    it("returns 401 with invalid signature", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/stripe",
        headers: { "stripe-signature": "t=123,v1=invalid_sig" },
        payload: { id: "evt_1", type: "test" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("processes valid Stripe webhook event", async () => {
      const payload = JSON.stringify({
        id: "evt_valid",
        type: "invoice.paid",
        data: { object: { id: "inv_1", customer: "cus_1" } },
        created: Date.now() / 1000,
      });

      const signature = buildStripeSignature(payload, "whsec_test");

      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/stripe",
        headers: {
          "stripe-signature": signature,
          "content-type": "application/json",
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
      expect(res.json().eventId).toBe("evt_valid");
    });

    it("dispatches payment_intent.succeeded to cartridge", async () => {
      const mockCartridge = {
        execute: vi.fn().mockResolvedValue({ data: {} }),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const payload = JSON.stringify({
        id: "evt_pay",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_1", amount: 5000, currency: "usd", customer: "cus_1" } },
        created: Date.now() / 1000,
      });

      const signature = buildStripeSignature(payload, "whsec_test");

      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/stripe",
        headers: {
          "stripe-signature": signature,
          "content-type": "application/json",
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(mockCartridge.execute).toHaveBeenCalledWith(
        "payment.log",
        expect.objectContaining({ paymentId: "pi_1" }),
        expect.any(Object),
      );
    });
  });

  describe("POST /api/inbound/forms", () => {
    it("receives a form submission", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/forms",
        payload: {
          source: "custom",
          fields: {
            firstName: "Alice",
            email: "alice@example.com",
            treatmentInterest: "Botox",
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
      expect(res.json().leadId).toBeDefined();
    });

    it("verifies Facebook signature when present", async () => {
      const body = JSON.stringify({
        source: "facebook",
        fields: { firstName: "Bob", email: "bob@test.com" },
        signature: "sha256=invalid",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/inbound/forms",
        headers: { "content-type": "application/json" },
        payload: body,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/inbound/forms/verify", () => {
    it("responds to Facebook verification challenge", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/inbound/forms/verify?hub.mode=subscribe&hub.verify_token=fb_verify_test&hub.challenge=challenge_123",
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("challenge_123");
    });

    it("rejects invalid verify token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/inbound/forms/verify?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=challenge_123",
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
