import type Stripe from "stripe";
import type {
  PaymentPort,
  DepositLinkInput,
  DepositLink,
  VerifiedPayment,
} from "@switchboard/schemas";

/**
 * The exact slice of the Stripe SDK this adapter touches. Typing it this
 * narrowly (rather than the whole `Stripe` instance) keeps the unit tests'
 * fake small and avoids `any` while preserving Stripe's real param/return
 * types. Signatures mirror stripe v22 (apps/api/node_modules/stripe/cjs).
 */
export interface StripeConnectClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Response<Stripe.Checkout.Session>>;
    };
  };
  paymentIntents: {
    retrieve(
      id: string,
      params?: Stripe.PaymentIntentRetrieveParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.Response<Stripe.PaymentIntent>>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event;
  };
}

export interface StripeConnectPaymentAdapterDeps {
  client: StripeConnectClient;
  /** The connected account id (acct_...) money is routed to. */
  connectedAccountId: string;
  /**
   * RECONCILIATION: DepositLinkInput has no successUrl/cancelUrl fields (real
   * 1A-4a schema: { bookingId, organizationId, amountCents, currency } only).
   * These redirect URLs are adapter constructor config, not per-link inputs.
   */
  successUrl: string;
  cancelUrl: string;
}

export class StripeConnectPaymentAdapter implements PaymentPort {
  private readonly client: StripeConnectClient;
  private readonly connectedAccountId: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;

  constructor(deps: StripeConnectPaymentAdapterDeps) {
    this.client = deps.client;
    this.connectedAccountId = deps.connectedAccountId;
    this.successUrl = deps.successUrl;
    this.cancelUrl = deps.cancelUrl;
  }

  async createDepositLink(input: DepositLinkInput): Promise<DepositLink> {
    // ONE STRIPE-SEMANTICS FLAG (go-live gate item, non-blocking for unit tests):
    // This body sets BOTH payment_intent_data.transfer_data.destination (destination
    // charge — created on the PLATFORM account with funds transferred to the connected
    // account) AND the stripeAccount RequestOptions (direct charge — created ON the
    // connected account). These are contradictory at the live Stripe API. Tests inject
    // a fake client, so all unit assertions pass as written. Before flipping to a real
    // connected account, reconcile to ONE Connect charge model:
    //   - Direct charge: keep stripeAccount + on_behalf_of, drop transfer_data
    //   - Destination charge: keep transfer_data + application_fee_amount, drop stripeAccount
    // Resolve at the go-live gate per spec §12 / the approved plan's flag.
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        success_url: this.successUrl,
        cancel_url: this.cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: "Deposit" },
            },
          },
        ],
        payment_intent_data: {
          transfer_data: { destination: this.connectedAccountId },
          metadata: { bookingId: input.bookingId, organizationId: input.organizationId },
        },
        metadata: { bookingId: input.bookingId, organizationId: input.organizationId },
      },
      {
        stripeAccount: this.connectedAccountId,
        idempotencyKey: `deposit_${input.bookingId}`,
      },
    );

    if (!session.url) {
      throw new Error(`Stripe Checkout Session for booking ${input.bookingId} has no url`);
    }
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    if (!paymentIntentId) {
      throw new Error(
        `Stripe Checkout Session for booking ${input.bookingId} has no payment_intent`,
      );
    }

    return {
      url: session.url,
      externalReference: paymentIntentId,
      // Echo back the caller's amountCents/currency — DepositLink requires them
      // (real 1A-4a schema). Authoritative amount for settlement comes from
      // retrievePayment (the money-authority rule, spec §9.4).
      amountCents: input.amountCents,
      currency: input.currency,
    };
  }

  async retrievePayment(externalReference: string): Promise<VerifiedPayment | null> {
    let intent: Stripe.Response<Stripe.PaymentIntent>;
    try {
      intent = await this.client.paymentIntents.retrieve(externalReference, undefined, {
        stripeAccount: this.connectedAccountId,
      });
    } catch (err) {
      // A missing PaymentIntent is a not-found, not a crash — let the caller
      // (the webhook route) treat it as "nothing to record".
      if (isStripeResourceMissing(err)) return null;
      throw err;
    }

    return {
      provider: "stripe",
      externalReference: intent.id,
      // amount/currency are the AUTHORITATIVE Stripe values — never a body amount.
      // Stripe amount is already minor units (cents); currency is lowercase ISO.
      // Do NOT re-multiply — a 100x bug destroys trust (spec §12).
      amountCents: intent.amount,
      currency: intent.currency,
      status: mapPaymentIntentStatus(intent.status),
    };
  }
}

/**
 * Map Stripe's PaymentIntent.Status onto the VerifiedPayment status union.
 * RECONCILIATION: real VerifiedPayment status is pending|paid|failed|refunded
 * (1A-4a schema). "succeeded" maps to "paid" (NOT "verified" — the plan's
 * snippet assumed a different enum; the real schema has no "verified" value).
 */
export function mapPaymentIntentStatus(
  status: Stripe.PaymentIntent.Status,
): VerifiedPayment["status"] {
  switch (status) {
    case "succeeded":
      return "paid";
    case "canceled":
      return "failed";
    default:
      // requires_payment_method | requires_confirmation | requires_action
      // | processing | requires_capture
      return "pending";
  }
}

function isStripeResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "resource_missing"
  );
}
