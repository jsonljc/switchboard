import { describe, it, expect, vi } from "vitest";
import {
  StripeConnectPaymentAdapter,
  verifyConnectWebhookSignature,
  type StripeConnectClient,
} from "./stripe-connect-payment-adapter.js";

// A structural fake of exactly the three Stripe resources the adapter uses.
// vi.fn lets us assert call args without any network or `any`.
function makeFakeClient(overrides?: { sessionUrl?: string; paymentIntentId?: string }): {
  client: StripeConnectClient;
  createSession: ReturnType<typeof vi.fn>;
  retrievePI: ReturnType<typeof vi.fn>;
  constructEvent: ReturnType<typeof vi.fn>;
} {
  const createSession = vi.fn(async () => ({
    url: overrides?.sessionUrl ?? "https://checkout.stripe.com/c/pay/cs_test_123",
    payment_intent: overrides?.paymentIntentId ?? "pi_test_123",
  }));
  const retrievePI = vi.fn();
  const constructEvent = vi.fn();
  const client = {
    checkout: { sessions: { create: createSession } },
    paymentIntents: { retrieve: retrievePI },
    webhooks: { constructEvent },
  } as unknown as StripeConnectClient;
  return { client, createSession, retrievePI, constructEvent };
}

const connectedAccountId = "acct_connected_1";

// RECONCILIATION NOTE: DepositLinkInput = { bookingId, organizationId, amountCents, currency }
// (NO successUrl/cancelUrl/description — those fields do not exist on the real schema).
// successUrl/cancelUrl are adapter constructor config. Tests call createDepositLink
// with ONLY the four real DepositLinkInput fields.
describe("StripeConnectPaymentAdapter.createDepositLink", () => {
  it("opens a Checkout Session on the connected account and returns url + externalReference", async () => {
    const { client, createSession } = makeFakeClient({
      sessionUrl: "https://checkout.stripe.com/c/pay/cs_live_abc",
      paymentIntentId: "pi_live_abc",
    });
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    const link = await adapter.createDepositLink({
      organizationId: "org_1",
      bookingId: "bk_1",
      amountCents: 5000,
      currency: "sgd",
    });

    expect(link.url).toBe("https://checkout.stripe.com/c/pay/cs_live_abc");
    expect(link.externalReference).toBe("pi_live_abc");
    // DepositLink also requires amountCents + currency (real schema).
    expect(link.amountCents).toBe(5000);
    expect(link.currency).toBe("sgd");

    // Direct charge: the session is created ON the connected account (the clinic).
    const [params, options] = createSession.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(options.stripeAccount).toBe(connectedAccountId);
    expect(params.mode).toBe("payment");
  });

  it("creates a DIRECT charge (clinic = merchant of record), not a destination charge", async () => {
    const { client, createSession } = makeFakeClient();
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    await adapter.createDepositLink({
      organizationId: "org_1",
      bookingId: "bk_1",
      amountCents: 5000,
      currency: "sgd",
    });

    const [params, options] = createSession.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // Direct-charge marker: the call is scoped to the connected account via the
    // Stripe-Account header, so the Charge + PaymentIntent live ON the clinic's
    // account, exactly what retrievePayment (1A-4d) re-fetches on that same account.
    expect(options.stripeAccount).toBe(connectedAccountId);

    const paymentIntentData = params.payment_intent_data as Record<string, unknown>;
    // NO destination-charge markers. transfer_data routes funds from a PLATFORM
    // charge to a connected account and is mutually exclusive with the Stripe-Account
    // header at the live API; on_behalf_of is a destination-charge construct that the
    // canonical direct-charge body omits.
    expect(paymentIntentData.transfer_data).toBeUndefined();
    expect(paymentIntentData.on_behalf_of).toBeUndefined();
    // No platform application fee is taken today (DepositLinkInput carries no fee
    // field); application_fee_amount stays a documented future hook, not set here.
    expect(paymentIntentData.application_fee_amount).toBeUndefined();
    // Metadata still carries the booking linkage the webhook re-reads server-side.
    expect(paymentIntentData.metadata).toEqual({ bookingId: "bk_1", organizationId: "org_1" });
  });
});

// ---------------------------------------------------------------------------
// Task 3: retrievePayment helper builders
// ---------------------------------------------------------------------------
function makeClientReturningPI(pi: {
  id: string;
  amount: number;
  currency: string;
  status: string;
}): { client: StripeConnectClient; retrievePI: ReturnType<typeof vi.fn> } {
  const retrievePI = vi.fn(async () => pi);
  const client = {
    checkout: { sessions: { create: vi.fn() } },
    paymentIntents: { retrieve: retrievePI },
    webhooks: { constructEvent: vi.fn() },
  } as unknown as StripeConnectClient;
  return { client, retrievePI };
}

// RECONCILIATION: VerifiedPayment status enum is pending|paid|failed|refunded
// (real 1A-4a schema, NOT "verified"). Stripe "succeeded" maps to "paid".
// VerifiedPayment also requires provider: string.
describe("StripeConnectPaymentAdapter.retrievePayment", () => {
  it("returns the AUTHORITATIVE Stripe-side amount/currency, not a body amount", async () => {
    const { client, retrievePI } = makeClientReturningPI({
      id: "pi_live_abc",
      amount: 5000,
      currency: "sgd",
      status: "succeeded",
    });
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    const result = await adapter.retrievePayment("pi_live_abc");

    expect(result).not.toBeNull();
    expect(result?.externalReference).toBe("pi_live_abc");
    // MONEY AUTHORITY: amount comes from Stripe, not from any body value.
    expect(result?.amountCents).toBe(5000);
    expect(result?.currency).toBe("sgd");
    // succeeded -> "paid" (real VerifiedPayment status, not "verified").
    expect(result?.status).toBe("paid");
    expect(result?.provider).toBe("stripe");
    // Re-fetched on the connected account.
    const [id, _params, options] = retrievePI.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(id).toBe("pi_live_abc");
    expect(options.stripeAccount).toBe(connectedAccountId);
  });

  it("maps non-terminal statuses to pending and canceled to failed", async () => {
    for (const [stripeStatus, expected] of [
      ["processing", "pending"],
      ["requires_payment_method", "pending"],
      ["requires_capture", "pending"],
      ["canceled", "failed"],
    ] as const) {
      const { client } = makeClientReturningPI({
        id: "pi_x",
        amount: 100,
        currency: "sgd",
        status: stripeStatus,
      });
      const adapter = new StripeConnectPaymentAdapter({
        client,
        connectedAccountId,
        successUrl: "https://app/success",
        cancelUrl: "https://app/cancel",
      });
      const result = await adapter.retrievePayment("pi_x");
      expect(result?.status).toBe(expected);
    }
  });
});

describe("StripeConnectPaymentAdapter.retrievePayment bookingId from metadata", () => {
  it("returns bookingId from PaymentIntent metadata when present", async () => {
    const retrievePI = vi.fn(async () => ({
      id: "pi_meta_1",
      amount: 6000,
      currency: "sgd",
      status: "succeeded",
      metadata: { bookingId: "bk-from-meta", organizationId: "org-1" },
    }));
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: retrievePI },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeConnectClient;
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    const result = await adapter.retrievePayment("pi_meta_1");

    expect(result).not.toBeNull();
    expect(result?.bookingId).toBe("bk-from-meta");
  });

  it("returns bookingId=null when metadata has no bookingId", async () => {
    const retrievePI = vi.fn(async () => ({
      id: "pi_meta_2",
      amount: 6000,
      currency: "sgd",
      status: "succeeded",
      metadata: {},
    }));
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: retrievePI },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeConnectClient;
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    const result = await adapter.retrievePayment("pi_meta_2");

    expect(result).not.toBeNull();
    expect(result?.bookingId).toBeNull();
  });

  it("returns bookingId=null when metadata is absent", async () => {
    const retrievePI = vi.fn(async () => ({
      id: "pi_meta_3",
      amount: 6000,
      currency: "sgd",
      status: "succeeded",
      // no metadata key at all
    }));
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: retrievePI },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeConnectClient;
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    const result = await adapter.retrievePayment("pi_meta_3");

    expect(result).not.toBeNull();
    expect(result?.bookingId).toBeNull();
  });
});

describe("StripeConnectPaymentAdapter.retrievePayment not-found", () => {
  it("returns null when the PaymentIntent does not exist", async () => {
    const retrievePI = vi.fn(async () => {
      throw Object.assign(new Error("No such payment_intent"), { code: "resource_missing" });
    });
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: retrievePI },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeConnectClient;
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    await expect(adapter.retrievePayment("pi_missing")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 2: Regression guard — re-issuing a deposit for the SAME bookingId must
// send the IDENTICAL Stripe-side idempotencyKey so Stripe deduplicates the
// Session and money is never double-charged. This is the RequestOptions key,
// distinct from the DB unique on externalReference owned by 1A-4a.
describe("StripeConnectPaymentAdapter.createDepositLink idempotency", () => {
  it("reuses the deterministic key `deposit_${bookingId}` on re-issue", async () => {
    const { client, createSession } = makeFakeClient();
    const adapter = new StripeConnectPaymentAdapter({
      client,
      connectedAccountId,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    const input = {
      organizationId: "org_1",
      bookingId: "bk_42",
      amountCents: 5000,
      currency: "sgd",
    };

    await adapter.createDepositLink(input);
    await adapter.createDepositLink(input);

    expect(createSession).toHaveBeenCalledTimes(2);
    const firstKey = (createSession.mock.calls[0] as [unknown, Record<string, unknown>])[1]
      .idempotencyKey;
    const secondKey = (createSession.mock.calls[1] as [unknown, Record<string, unknown>])[1]
      .idempotencyKey;
    expect(firstKey).toBe("deposit_bk_42");
    expect(secondKey).toBe("deposit_bk_42");
    expect(firstKey).toBe(secondKey);
  });
});

describe("verifyConnectWebhookSignature", () => {
  it("returns the constructed event using the per-org Connect secret", () => {
    const fakeEvent = { id: "evt_1", type: "payment_intent.succeeded" };
    const constructEvent = vi.fn(() => fakeEvent);
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: vi.fn() },
      webhooks: { constructEvent },
    } as unknown as StripeConnectClient;

    const event = verifyConnectWebhookSignature(
      client,
      '{"id":"evt_1"}',
      "t=1,v1=goodsig",
      "whsec_connect_secret",
    );

    expect(event).toBe(fakeEvent);
    expect(constructEvent).toHaveBeenCalledWith(
      '{"id":"evt_1"}',
      "t=1,v1=goodsig",
      "whsec_connect_secret",
    );
  });

  it("rethrows when the signature is tampered (constructEvent throws)", () => {
    const constructEvent = vi.fn(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      paymentIntents: { retrieve: vi.fn() },
      webhooks: { constructEvent },
    } as unknown as StripeConnectClient;

    expect(() =>
      verifyConnectWebhookSignature(
        client,
        '{"id":"evt_1"}',
        "t=1,v1=BADSIG",
        "whsec_connect_secret",
      ),
    ).toThrow(/No signatures found/);
  });
});
