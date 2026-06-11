import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { createHmac } from "node:crypto";
import { paymentsWebhookRoutes } from "../payments-webhook.js";
import { RecordVerifiedPaymentParametersSchema } from "../operator-intents-schemas-payment.js";

// PSP payments webhook ingress-receiver. Mirrors ad-optimizer-signature.test.ts:
// the route must verify an HMAC over the RAW body (STRIPE_WEBHOOK_SECRET) and
// fail closed (401) on any missing/forged signature or missing secret, BEFORE
// trusting any body field.

const SECRET = "test-webhook-secret";
// Valid JSON whose connected-account id resolves to NO Connection, so a verified
// request short-circuits at 200 without needing a real port/ingress.
const PAYLOAD = JSON.stringify({
  id: "evt_sig_1",
  type: "charge.succeeded",
  data: { object: { id: "ch_sig_1", amount: 9999, account: "acct_unknown" } },
});

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  app.decorate("prisma", { connection: { findFirst: async () => null } } as never);
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
  return app;
}

async function postWebhook(app: FastifyInstance, signature: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/api/webhooks/payments/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-payment-signature": signature } : {}),
    },
    payload: PAYLOAD,
  });
}

describe("Payments webhook signature verification", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("accepts a request carrying a valid x-payment-signature (org unresolved -> 200 skip)", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, SECRET));
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a request with no signature header", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, undefined);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a forged signature", async () => {
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, "wrong-secret"));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("fails closed when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    const app = await buildApp();
    const res = await postWebhook(app, sign(PAYLOAD, SECRET));
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// --- helpers shared by the resolve/refetch/replay blocks ---
function bodyWithCharge(eventId: string, chargeId: string, account: string, bodyAmount: number) {
  return JSON.stringify({
    id: eventId,
    type: "charge.succeeded",
    data: { object: { id: chargeId, amount: bodyAmount, account } },
  });
}

function makeSubmitSpy() {
  // Mimics PlatformIngress idempotency: same key returns the prior result and does
  // NOT re-run downstream effects (platform-ingress.ts:100-160).
  const seen = new Map<string, { id: string; traceId: string }>();
  const calls: Array<Record<string, unknown>> = [];
  const submit = vi.fn(async (req: Record<string, unknown>) => {
    calls.push(req);
    const key = String(req["idempotencyKey"]);
    const existing = seen.get(key);
    if (existing) {
      return { ok: true as const, result: {}, workUnit: existing };
    }
    const wu = { id: `wu-${seen.size + 1}`, traceId: `tr-${seen.size + 1}` };
    seen.set(key, wu);
    return { ok: true as const, result: {}, workUnit: wu };
  });
  return { submit, calls };
}

async function buildResolvingApp(opts: {
  connectionOrgId: string | null;
  retrievePayment: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  bookingFindFirst?: ReturnType<typeof vi.fn>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  app.decorate("prisma", {
    connection: {
      findFirst: async () =>
        opts.connectionOrgId ? { organizationId: opts.connectionOrgId } : null,
    },
    booking: {
      findFirst: opts.bookingFindFirst ?? vi.fn(async () => null),
    },
  } as never);
  app.decorate("platformIngress", { submit: opts.submit } as never);
  app.decorate(
    "paymentPortFactory",
    async () =>
      ({
        retrievePayment: opts.retrievePayment,
      }) as never,
  );
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
  return app;
}

describe("Payments webhook org resolution + charge re-fetch", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("refuses to submit when the org cannot be resolved (no Connection)", async () => {
    const retrievePayment = vi.fn();
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({ connectionOrgId: null, retrievePayment, submit });
    const payload = bodyWithCharge("evt_noorg", "ch_noorg", "acct_unknown", 9999);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).not.toHaveBeenCalled();
    expect(retrievePayment).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("re-fetches the charge by id and submits the RE-FETCHED amount, never the body amount", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: "bk-1",
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
      status: "paid" as const,
    }));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_amt", "ch_amt", "acct_org1", 9999);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(retrievePayment).toHaveBeenCalledWith("ch_amt");
    expect(submit).toHaveBeenCalledTimes(1);
    const req = calls[0]!;
    expect(req["intent"]).toBe("payment.record_verified");
    expect(req["organizationId"]).toBe("org-1");
    const params = req["parameters"] as { amountCents: number; provider: string };
    expect(params.amountCents).toBe(5000); // RE-FETCHED, not body's 9999
    expect(params.provider).toBe("stripe");
    await app.close();
  });
});

// Task 3: pins the idempotency contract — same provider message id must produce the same
// idempotencyKey ("psp-<id>") on both calls so PlatformIngress deduplicates to one record.
describe("Payments webhook replay (idempotency at ingress)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("replaying the same provider message id dedups to one ingress record", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: "bk-replay",
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
      status: "paid" as const,
    }));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c-r", opportunityId: "opp-r" }));
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_replay", "ch_replay", "acct_org1", 5000);
    const headers = {
      "content-type": "application/json",
      "x-payment-signature": sign(payload, SECRET),
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Both submits carried the SAME message-id-derived key...
    expect(calls).toHaveLength(2);
    expect(calls[0]!["idempotencyKey"]).toBe("psp-evt_replay");
    expect(calls[1]!["idempotencyKey"]).toBe("psp-evt_replay");
    // ...and ingress deduped to one workUnit (the replay is a no-op effect).
    expect((first.json() as { workUnitId: string }).workUnitId).toBe(
      (second.json() as { workUnitId: string }).workUnitId,
    );
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Contract-pin: submitted parameters must satisfy RecordVerifiedPaymentParametersSchema
// RED before fix (missing contactId/opportunityId/bookingId) → GREEN after.
// ---------------------------------------------------------------------------
describe("Payments webhook contract-pin: submitted params satisfy handler schema", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"];
    else process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  });

  it("happy path: submitted parameters satisfy RecordVerifiedPaymentParametersSchema", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: "bk-contract",
      amountCents: 7500,
      currency: "sgd",
      provider: "stripe",
      status: "paid" as const,
    }));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-contract",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_contract", "ch_contract", "acct_contract", 9999);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    const params = (calls[0] as Record<string, unknown>)["parameters"];
    // The core assertion: the schema the handler validates against must pass.
    expect(RecordVerifiedPaymentParametersSchema.safeParse(params).success).toBe(true);
    expect(params).toMatchObject({
      contactId: "c1",
      opportunityId: "opp1",
      bookingId: "bk-contract",
      amountCents: 7500, // RE-FETCHED, not body's 9999
      provider: "stripe",
    });
    await app.close();
  });

  it("skips (200, no submit) when charge.bookingId is null", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: null,
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
      status: "paid" as const,
    }));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const { submit } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_nobk", "ch_nobk", "acct_org1", 5000);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      received: true,
      skipped: true,
      reason: "no_booking_linkage",
    });
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("skips (200, no submit) when booking.findFirst returns null", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: "bk-missing",
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
      status: "paid" as const,
    }));
    const bookingFindFirst = vi.fn(async () => null);
    const { submit } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_norow", "ch_norow", "acct_org1", 5000);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      received: true,
      skipped: true,
      reason: "booking_not_resolvable",
    });
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("skips (200, no submit) when booking.contactId is null", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: "bk-nocontact",
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
      status: "paid" as const,
    }));
    // Booking exists but contactId is null (guard against orphaned bookings)
    const bookingFindFirst = vi.fn(async () => ({ contactId: null, opportunityId: "opp1" }));
    const { submit } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_noc", "ch_noc", "acct_org1", 5000);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      received: true,
      skipped: true,
      reason: "booking_not_resolvable",
    });
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("skips (200, no submit) when the re-fetched charge is not paid", async () => {
    const retrievePayment = vi.fn(async (id: string) => ({
      externalReference: id,
      bookingId: "bk-pending",
      amountCents: 5000,
      currency: "sgd",
      provider: "stripe",
      status: "pending" as const,
    }));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const { submit } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const payload = bodyWithCharge("evt_pending", "ch_pending", "acct_org1", 5000);
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/payments/webhook",
      headers: { "content-type": "application/json", "x-payment-signature": sign(payload, SECRET) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true, skipped: true, reason: "charge_not_paid" });
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });
});
