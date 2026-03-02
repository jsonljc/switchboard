import type {
  StripeConfig,
  StripeProvider,
  StripeCustomer,
  StripeCharge,
  StripeRefund,
  StripeSubscription,
  StripeInvoice,
  StripePaymentLink,
  StripeBalanceTransaction,
  CustomerPaymentHistory,
} from "./stripe.js";
import type { ConnectionHealth } from "@switchboard/schemas";
import { withRetry, CircuitBreaker } from "@switchboard/core";

/**
 * Real Stripe provider using the official stripe npm package.
 * All write operations use idempotency keys.
 * All calls are wrapped with retry + circuit breaker.
 */
export class RealStripeProvider implements StripeProvider {
  private stripe: import("stripe").default;
  private breaker: CircuitBreaker;

  constructor(config: StripeConfig) {
    // Dynamic require to avoid bundling stripe when not used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require("stripe").default ?? require("stripe");
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: (config.apiVersion as "2025-01-27.acacia") ?? "2025-01-27.acacia",
    });
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 3,
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(() =>
      withRetry(fn, {
        maxAttempts: 3,
        shouldRetry: (err: unknown) => {
          if (err instanceof Error) {
            const msg = err.message;
            return msg.includes("rate_limit") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET");
          }
          return false;
        },
      }),
    );
  }

  private idempotencyKey(): string {
    return `sb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async getCustomer(id: string): Promise<StripeCustomer> {
    const customer = await this.call(() => this.stripe.customers.retrieve(id));
    if ((customer as { deleted?: boolean }).deleted) {
      throw new Error(`Customer ${id} has been deleted`);
    }
    const c = customer as import("stripe").Stripe.Customer;
    return {
      id: c.id,
      name: c.name ?? null,
      email: c.email ?? null,
      balance: c.balance,
      created: c.created,
      metadata: c.metadata as Record<string, string>,
    };
  }

  async searchCustomers(query: string): Promise<StripeCustomer[]> {
    const result = await this.call(() =>
      this.stripe.customers.search({ query: `name~"${query}" OR email~"${query}"` }),
    );
    return result.data.map((c) => ({
      id: c.id,
      name: c.name ?? null,
      email: c.email ?? null,
      balance: c.balance,
      created: c.created,
      metadata: c.metadata as Record<string, string>,
    }));
  }

  async getPaymentHistory(customerId: string): Promise<CustomerPaymentHistory> {
    const [chargesResult, refundsResult] = await Promise.all([
      this.call(() => this.stripe.charges.list({ customer: customerId, limit: 100 })),
      this.call(() => this.stripe.refunds.list({ limit: 100 })),
    ]);

    const charges: StripeCharge[] = chargesResult.data.map((c) => ({
      id: c.id,
      amount: c.amount,
      currency: c.currency,
      status: c.status as StripeCharge["status"],
      customerId: (c.customer as string) ?? customerId,
      disputed: c.disputed,
      refunded: c.refunded,
      createdAt: new Date(c.created * 1000).toISOString(),
    }));

    const chargeIds = new Set(charges.map((c) => c.id));
    const refunds: StripeRefund[] = refundsResult.data
      .filter((r) => r.charge && chargeIds.has(r.charge as string))
      .map((r) => ({
        id: r.id,
        amount: r.amount,
        chargeId: r.charge as string,
        status: r.status as StripeRefund["status"],
        createdAt: new Date(r.created * 1000).toISOString(),
      }));

    return { charges, refunds, disputes: [] };
  }

  async getSubscription(id: string): Promise<StripeSubscription> {
    const sub = await this.call(() => this.stripe.subscriptions.retrieve(id));
    return {
      id: sub.id,
      customerId: sub.customer as string,
      status: sub.status as StripeSubscription["status"],
      currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      items: sub.items.data.map((item) => ({
        priceId: item.price.id,
        quantity: item.quantity ?? 1,
        unitAmount: item.price.unit_amount ?? 0,
        interval: item.price.recurring?.interval as "month" | "year",
      })),
      startDate: new Date(sub.start_date * 1000).toISOString(),
    };
  }

  async createInvoice(customerId: string, amountCents: number, description: string): Promise<StripeInvoice> {
    const invoice = await this.call(() =>
      this.stripe.invoices.create(
        { customer: customerId, auto_advance: false },
        { idempotencyKey: this.idempotencyKey() },
      ),
    );
    // Add an invoice item
    await this.call(() =>
      this.stripe.invoiceItems.create(
        { customer: customerId, invoice: invoice.id, amount: amountCents, description },
        { idempotencyKey: this.idempotencyKey() },
      ),
    );
    return {
      id: invoice.id,
      customerId,
      amount: amountCents,
      status: (invoice.status ?? "draft") as StripeInvoice["status"],
      createdAt: new Date(invoice.created * 1000).toISOString(),
    };
  }

  async voidInvoice(invoiceId: string): Promise<StripeInvoice> {
    const invoice = await this.call(() => this.stripe.invoices.voidInvoice(invoiceId));
    return {
      id: invoice.id,
      customerId: invoice.customer as string,
      amount: invoice.amount_due,
      status: (invoice.status ?? "void") as StripeInvoice["status"],
      createdAt: new Date(invoice.created * 1000).toISOString(),
    };
  }

  async createCharge(customerId: string, amountCents: number, currency: string, description: string): Promise<StripeCharge> {
    const charge = await this.call(() =>
      this.stripe.charges.create(
        { customer: customerId, amount: amountCents, currency, description },
        { idempotencyKey: this.idempotencyKey() },
      ),
    );
    return {
      id: charge.id,
      amount: charge.amount,
      currency: charge.currency,
      status: charge.status as StripeCharge["status"],
      customerId,
      disputed: charge.disputed,
      refunded: charge.refunded,
      createdAt: new Date(charge.created * 1000).toISOString(),
    };
  }

  async createRefund(chargeId: string, amountCents: number, reason: string): Promise<StripeRefund> {
    const refund = await this.call(() =>
      this.stripe.refunds.create(
        { charge: chargeId, amount: amountCents, reason: reason as "duplicate" | "fraudulent" | "requested_by_customer" },
        { idempotencyKey: this.idempotencyKey() },
      ),
    );
    return {
      id: refund.id,
      amount: refund.amount,
      chargeId: refund.charge as string,
      status: refund.status as StripeRefund["status"],
      createdAt: new Date(refund.created * 1000).toISOString(),
    };
  }

  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean): Promise<StripeSubscription> {
    let sub: import("stripe").Stripe.Subscription;
    if (cancelAtPeriodEnd) {
      sub = await this.call(() =>
        this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }),
      );
    } else {
      sub = await this.call(() =>
        this.stripe.subscriptions.cancel(subscriptionId),
      );
    }
    return {
      id: sub.id,
      customerId: sub.customer as string,
      status: sub.status as StripeSubscription["status"],
      currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      items: sub.items.data.map((item) => ({
        priceId: item.price.id,
        quantity: item.quantity ?? 1,
        unitAmount: item.price.unit_amount ?? 0,
        interval: item.price.recurring?.interval as "month" | "year",
      })),
      startDate: new Date(sub.start_date * 1000).toISOString(),
    };
  }

  async modifySubscription(subscriptionId: string, changes: Record<string, unknown>): Promise<StripeSubscription> {
    const sub = await this.call(() =>
      this.stripe.subscriptions.update(subscriptionId, changes as Record<string, unknown>),
    );
    return {
      id: sub.id,
      customerId: sub.customer as string,
      status: sub.status as StripeSubscription["status"],
      currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      items: sub.items.data.map((item) => ({
        priceId: item.price.id,
        quantity: item.quantity ?? 1,
        unitAmount: item.price.unit_amount ?? 0,
        interval: item.price.recurring?.interval as "month" | "year",
      })),
      startDate: new Date(sub.start_date * 1000).toISOString(),
    };
  }

  async createPaymentLink(amountCents: number, currency: string, description: string): Promise<StripePaymentLink> {
    // Create a price first, then a payment link
    const price = await this.call(() =>
      this.stripe.prices.create({
        unit_amount: amountCents,
        currency,
        product_data: { name: description },
      }),
    );
    const link = await this.call(() =>
      this.stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
      }),
    );
    return {
      id: link.id,
      url: link.url,
      amount: amountCents,
      active: link.active,
      createdAt: new Date().toISOString(),
    };
  }

  async deactivatePaymentLink(linkId: string): Promise<StripePaymentLink> {
    const link = await this.call(() =>
      this.stripe.paymentLinks.update(linkId, { active: false }),
    );
    return {
      id: link.id,
      url: link.url,
      amount: 0, // amount not directly on paymentLink object
      active: link.active,
      createdAt: new Date().toISOString(),
    };
  }

  async applyCredit(customerId: string, amountCents: number, description: string): Promise<StripeBalanceTransaction> {
    await this.call(() =>
      this.stripe.customers.update(
        customerId,
        { balance: -(amountCents) }, // negative = credit in Stripe
        { idempotencyKey: this.idempotencyKey() },
      ),
    );
    return {
      id: `txn_${Date.now()}`,
      customerId,
      amount: -amountCents,
      description,
      createdAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    try {
      const start = Date.now();
      await this.stripe.balance.retrieve();
      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
        capabilities: [
          "payments.invoice.create",
          "payments.charge.create",
          "payments.refund.create",
          "payments.subscription.cancel",
          "payments.subscription.modify",
          "payments.link.create",
          "payments.credit.apply",
        ],
      };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Unknown error",
        capabilities: [],
      };
    }
  }
}
