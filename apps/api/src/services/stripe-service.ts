// ---------------------------------------------------------------------------
// Stripe billing service — checkout, portal, webhook handling
// ---------------------------------------------------------------------------

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-04-22.dahlia",
});

export interface CreateCheckoutInput {
  organizationId: string;
  email: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingStatus {
  subscriptionStatus: string;
  currentPlan: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export async function createCheckoutSession(input: CreateCheckoutInput): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    customer_email: input.email,
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 30,
      metadata: { organizationId: input.organizationId },
    },
    metadata: { organizationId: input.organizationId },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe checkout session created without a URL");
  }

  return session.url;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

export interface WebhookResult {
  type: string;
  organizationId?: string;
  data: Record<string, unknown>;
}

export async function handleWebhookEvent(body: string, signature: string): Promise<WebhookResult> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

  const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

  let organizationId: string | undefined;
  const data: Record<string, unknown> = {};

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      organizationId = session.metadata?.organizationId ?? undefined;
      data.customerId = session.customer as string;
      data.subscriptionId = session.subscription as string;
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      organizationId = sub.metadata?.organizationId ?? undefined;
      data.status = sub.status;
      const firstItem = sub.items.data[0];
      data.priceId = firstItem?.price.id ?? null;
      // In Stripe v22+, current_period_end lives on SubscriptionItem, not Subscription
      const periodEnd = firstItem?.current_period_end;
      data.currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      data.cancelAtPeriodEnd = sub.cancel_at_period_end;
      data.trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      organizationId = invoice.parent?.subscription_details?.metadata?.organizationId ?? undefined;
      data.attemptCount = invoice.attempt_count;
      break;
    }
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      organizationId = sub.metadata?.organizationId ?? undefined;
      data.trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
      break;
    }
  }

  return { type: event.type, organizationId, data };
}

export { stripe };
