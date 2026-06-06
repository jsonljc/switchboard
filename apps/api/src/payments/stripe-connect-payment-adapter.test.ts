import { describe, it, expect, vi } from "vitest";
import {
  StripeConnectPaymentAdapter,
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

    // Destination charge: the session is created ON the connected account.
    const [params, options] = createSession.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(options.stripeAccount).toBe(connectedAccountId);
    expect(params.mode).toBe("payment");
  });
});

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
