import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import Stripe from "stripe";
import { paymentsWebhookRoutes } from "../payments-webhook.js";
import {
  verifyConnectWebhookSignature,
  type StripeConnectClient,
} from "../../payments/stripe-connect-payment-adapter.js";
import { RecordVerifiedPaymentParametersSchema } from "../operator-intents-schemas-payment.js";

// Stripe Connect deposit settlement webhook (1A-4d). A platform-level Connect endpoint
// receives `payment_intent.succeeded` events from connected clinic accounts, each carrying
// the connected account at the TOP-LEVEL `event.account`. The route verifies natively
// (constructEvent over the Stripe-Signature header with the platform Connect signing secret),
// re-fetches the PaymentIntent by id (never trusts the body amount), and submits through
// ingress as a service actor. These tests pin the REAL event shape + the REAL verification
// scheme. The `stripe` client below is used ONLY for crypto (constructEvent +
// generateTestHeaderString make no network call), so a dummy api key is fine.

const SECRET = "whsec_test_connect_secret";
const stripe = new Stripe("sk_test_dummy", { apiVersion: "2026-04-22.dahlia" });

const realVerifier = (secret: string) => (raw: string | Buffer, sig: string) =>
  verifyConnectWebhookSignature(stripe as unknown as StripeConnectClient, raw, sig, secret);

const sign = (body: string, secret: string): string =>
  stripe.webhooks.generateTestHeaderString({ payload: body, secret });

// REAL payment_intent.succeeded Connect event: top-level `account`, data.object = PaymentIntent.
function piSucceeded(o: {
  eventId: string;
  account?: string;
  paymentIntentId: string;
  amount?: number;
}): string {
  return JSON.stringify({
    id: o.eventId,
    object: "event",
    type: "payment_intent.succeeded",
    ...(o.account ? { account: o.account } : {}),
    data: {
      object: {
        id: o.paymentIntentId,
        object: "payment_intent",
        status: "succeeded",
        amount: o.amount ?? 9999,
        currency: "sgd",
        metadata: { bookingId: "bk-meta", organizationId: "org-meta" },
      },
    },
  });
}

// A non-target event type (checkout.session.completed): data.object is a session, NOT a
// PaymentIntent, so the route must ignore it rather than re-fetch a cs_ id as a PaymentIntent.
function otherTypeEvent(eventId: string, account: string): string {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    account,
    data: { object: { id: "cs_123", object: "checkout.session" } },
  });
}

async function post(app: FastifyInstance, body: string, signature?: string) {
  return app.inject({
    method: "POST",
    url: "/api/webhooks/payments/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    payload: body,
  });
}

// --- Signature + event-type gate (no port/ingress needed; org resolves to none) ---

async function buildApp(opts?: { decorateVerifier?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rawBody, { field: "rawBody", global: false });
  app.decorate("prisma", { connection: { findFirst: async () => null } } as never);
  if (opts?.decorateVerifier !== false) {
    app.decorate("paymentWebhookVerifier", realVerifier(SECRET) as never);
  }
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
  return app;
}

describe("Payments webhook native Stripe Connect verification", () => {
  it("accepts a valid Stripe-Signature for payment_intent.succeeded (org unresolved -> 200 skip)", async () => {
    const app = await buildApp();
    const body = piSucceeded({
      eventId: "evt_ok",
      account: "acct_unknown",
      paymentIntentId: "pi_ok",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true, skipped: true, reason: "no_org" });
    await app.close();
  });

  it("rejects a request with no Stripe-Signature header -> 401", async () => {
    const app = await buildApp();
    const body = piSucceeded({ eventId: "evt_nosig", account: "acct_x", paymentIntentId: "pi_x" });
    const res = await post(app, body, undefined);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a tampered body (valid sig over a different body) -> 401", async () => {
    const app = await buildApp();
    const signed = piSucceeded({ eventId: "evt_a", account: "acct_x", paymentIntentId: "pi_a" });
    const tampered = piSucceeded({ eventId: "evt_b", account: "acct_x", paymentIntentId: "pi_b" });
    const res = await post(app, tampered, sign(signed, SECRET));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a signature from the wrong secret -> 401", async () => {
    const app = await buildApp();
    const body = piSucceeded({ eventId: "evt_w", account: "acct_x", paymentIntentId: "pi_w" });
    const res = await post(app, body, sign(body, "whsec_wrong"));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("fails closed with 503 when the verifier is not configured", async () => {
    const app = await buildApp({ decorateVerifier: false });
    const body = piSucceeded({ eventId: "evt_503", account: "acct_x", paymentIntentId: "pi_503" });
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("ignores a non-target event type -> 200 skip, no routing", async () => {
    const app = await buildApp();
    const body = otherTypeEvent("evt_other", "acct_x");
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      received: true,
      skipped: true,
      reason: "ignored_event_type",
    });
    await app.close();
  });

  it("skips when the connected account is missing on the event -> 200 {no_account}", async () => {
    const app = await buildApp();
    const body = piSucceeded({ eventId: "evt_noacct", paymentIntentId: "pi_noacct" }); // no account
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true, skipped: true, reason: "no_account" });
    await app.close();
  });
});

// --- Org resolution + charge re-fetch + replay + contract-pin ---

function makeSubmitSpy() {
  // Mimics PlatformIngress idempotency: same key returns the prior result and does
  // NOT re-run downstream effects (platform-ingress.ts).
  const seen = new Map<string, { id: string; traceId: string }>();
  const calls: Array<Record<string, unknown>> = [];
  const submit = vi.fn(async (req: Record<string, unknown>) => {
    calls.push(req);
    const key = String(req["idempotencyKey"]);
    const existing = seen.get(key);
    if (existing) {
      return { ok: true as const, result: { outcome: "completed" as const }, workUnit: existing };
    }
    const wu = { id: `wu-${seen.size + 1}`, traceId: `tr-${seen.size + 1}` };
    seen.set(key, wu);
    return { ok: true as const, result: { outcome: "completed" as const }, workUnit: wu };
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
  app.decorate("paymentPortFactory", (async () => ({
    retrievePayment: opts.retrievePayment,
  })) as never);
  app.decorate("paymentWebhookVerifier", realVerifier(SECRET) as never);
  await app.register(paymentsWebhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
  return app;
}

describe("Payments webhook org resolution + charge re-fetch", () => {
  it("refuses to submit when the org cannot be resolved (no Connection)", async () => {
    const retrievePayment = vi.fn();
    const { submit, calls } = makeSubmitSpy();
    const app = await buildResolvingApp({ connectionOrgId: null, retrievePayment, submit });
    const body = piSucceeded({
      eventId: "evt_noorg",
      account: "acct_unknown",
      paymentIntentId: "pi_noorg",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(submit).not.toHaveBeenCalled();
    expect(retrievePayment).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("re-fetches the PaymentIntent by id and submits the RE-FETCHED amount, never the body amount", async () => {
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
    const body = piSucceeded({
      eventId: "evt_amt",
      account: "acct_org1",
      paymentIntentId: "pi_amt",
      amount: 9999,
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(retrievePayment).toHaveBeenCalledWith("pi_amt"); // the PaymentIntent id from data.object.id
    expect(submit).toHaveBeenCalledTimes(1);
    const req = calls[0]!;
    expect(req["intent"]).toBe("payment.record_verified");
    expect(req["organizationId"]).toBe("org-1");
    expect((req["actor"] as { id: string; type: string }).type).toBe("service");
    expect(req["idempotencyKey"]).toBe("psp-evt_amt"); // keyed on the Stripe event id
    const params = req["parameters"] as { amountCents: number; provider: string };
    expect(params.amountCents).toBe(5000); // RE-FETCHED, not body's 9999
    expect(params.provider).toBe("stripe");
    await app.close();
  });
});

describe("Payments webhook replay (idempotency at ingress)", () => {
  it("replaying the same Stripe event id dedups to one ingress record", async () => {
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
    const body = piSucceeded({
      eventId: "evt_replay",
      account: "acct_org1",
      paymentIntentId: "pi_replay",
    });
    const signature = sign(body, SECRET);
    const first = await post(app, body, signature);
    const second = await post(app, body, signature);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Both submits carried the SAME event-id-derived key...
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

describe("Payments webhook contract-pin: submitted params satisfy handler schema", () => {
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
    const body = piSucceeded({
      eventId: "evt_contract",
      account: "acct_contract",
      paymentIntentId: "pi_contract",
      amount: 9999,
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    const params = (calls[0] as Record<string, unknown>)["parameters"];
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
    const body = piSucceeded({
      eventId: "evt_nobk",
      account: "acct_org1",
      paymentIntentId: "pi_nobk",
    });
    const res = await post(app, body, sign(body, SECRET));
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
    const body = piSucceeded({
      eventId: "evt_norow",
      account: "acct_org1",
      paymentIntentId: "pi_norow",
    });
    const res = await post(app, body, sign(body, SECRET));
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
    const bookingFindFirst = vi.fn(async () => ({ contactId: null, opportunityId: "opp1" }));
    const { submit } = makeSubmitSpy();
    const app = await buildResolvingApp({
      connectionOrgId: "org-1",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const body = piSucceeded({
      eventId: "evt_noc",
      account: "acct_org1",
      paymentIntentId: "pi_noc",
    });
    const res = await post(app, body, sign(body, SECRET));
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
    const body = piSucceeded({
      eventId: "evt_pending",
      account: "acct_org1",
      paymentIntentId: "pi_pending",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true, skipped: true, reason: "charge_not_paid" });
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });
});

// --- A22: ingress-failure handling. A settled deposit must never 500-storm Stripe ---
// payment.record_verified is carved out of the entitlement gate upstream, so this branch
// is defense-in-depth: if ingress ever returns entitlement_required (carve-out absent /
// regressed), acknowledge with 200 + a reconciliation reason instead of a 500 that would
// trigger Stripe redelivery forever AND re-lose the settled-but-unrecorded receipt. A
// genuinely retryable error keeps the 500 so Stripe's redelivery can succeed later.
describe("Payments webhook ingress-failure handling (A22)", () => {
  const paidCharge = (id: string) => ({
    externalReference: id,
    bookingId: "bk-a22",
    amountCents: 5000,
    currency: "sgd",
    provider: "stripe",
    status: "paid" as const,
  });

  it("acknowledges an entitlement-blocked deposit with 200 + reconciliation reason, never a 500 storm", async () => {
    const retrievePayment = vi.fn(async (id: string) => paidCharge(id));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const submit = vi.fn(async () => ({
      ok: false as const,
      error: {
        type: "entitlement_required" as const,
        intent: "payment.record_verified",
        message: "Organization org-ent is not entitled to execute paid actions (status: canceled)",
        blockedStatus: "canceled",
      },
    }));
    const app = await buildResolvingApp({
      connectionOrgId: "org-ent",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const body = piSucceeded({
      eventId: "evt_ent",
      account: "acct_ent",
      paymentIntentId: "pi_ent",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      received: true,
      skipped: true,
      reason: "entitlement_blocked_reconcile",
    });
    await app.close();
  });

  it("still returns 500 on a retryable ingress error so Stripe redelivers", async () => {
    const retrievePayment = vi.fn(async (id: string) => paidCharge(id));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const submit = vi.fn(async () => ({
      ok: false as const,
      error: {
        type: "upstream_error" as const,
        intent: "payment.record_verified",
        message: "transient downstream failure",
      },
    }));
    const app = await buildResolvingApp({
      connectionOrgId: "org-up",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const body = piSucceeded({ eventId: "evt_up", account: "acct_up", paymentIntentId: "pi_up" });
    const res = await post(app, body, sign(body, SECRET));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  // A successful envelope (ok:true) whose handler did NOT complete — outcome "failed"
  // (a domain return, or EXECUTION_EXCEPTION when the receipt/revenue write throws on a
  // transient DB error) — must 500 so Stripe redelivers. Acking 200 here permanently
  // loses the receipt/revenue/conversion for money that already moved.
  it("fails closed with 500 when ingress returns ok:true but outcome is 'failed'", async () => {
    const retrievePayment = vi.fn(async (id: string) => paidCharge(id));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const submit = vi.fn(async () => ({
      ok: true as const,
      result: { outcome: "failed" as const },
      workUnit: { id: "wu-failed", traceId: "tr-failed" },
    }));
    const app = await buildResolvingApp({
      connectionOrgId: "org-failed",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const body = piSucceeded({
      eventId: "evt_failed",
      account: "acct_failed",
      paymentIntentId: "pi_failed",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  // A parked/deferred outcome (approvalRequired, or outcome "queued") is likewise NOT a
  // durable record — fail closed so the settled deposit is redelivered, not silently 200'd.
  it("fails closed with 500 when ingress parks/queues instead of completing", async () => {
    const retrievePayment = vi.fn(async (id: string) => paidCharge(id));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const submit = vi.fn(async () => ({
      ok: true as const,
      result: { outcome: "queued" as const },
      workUnit: { id: "wu-queued", traceId: "tr-queued" },
    }));
    const app = await buildResolvingApp({
      connectionOrgId: "org-queued",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const body = piSucceeded({
      eventId: "evt_queued",
      account: "acct_queued",
      paymentIntentId: "pi_queued",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  // Defensive: a settled deposit that ingress parks for approval (approvalRequired) is
  // not durably recorded either — fail closed so Stripe redelivers.
  it("fails closed with 500 when ingress parks the deposit for approval", async () => {
    const retrievePayment = vi.fn(async (id: string) => paidCharge(id));
    const bookingFindFirst = vi.fn(async () => ({ contactId: "c1", opportunityId: "opp1" }));
    const submit = vi.fn(async () => ({
      ok: true as const,
      result: { outcome: "pending_approval" as const },
      workUnit: { id: "wu-parked", traceId: "tr-parked" },
      approvalRequired: true as const,
    }));
    const app = await buildResolvingApp({
      connectionOrgId: "org-parked",
      retrievePayment,
      submit,
      bookingFindFirst,
    });
    const body = piSucceeded({
      eventId: "evt_parked",
      account: "acct_parked",
      paymentIntentId: "pi_parked",
    });
    const res = await post(app, body, sign(body, SECRET));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
