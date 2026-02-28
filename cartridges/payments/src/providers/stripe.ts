import type { ConnectionHealth } from "@switchboard/schemas";

export interface StripeConfig {
  secretKey: string;
  apiVersion?: string;
}

export interface StripeCustomer {
  id: string;
  name: string | null;
  email: string | null;
  balance: number; // cents
  created: number; // unix timestamp
  metadata: Record<string, string>;
}

export interface StripeCharge {
  id: string;
  amount: number; // cents
  currency: string;
  status: "succeeded" | "pending" | "failed";
  customerId: string;
  disputed: boolean;
  refunded: boolean;
  createdAt: string;
}

export interface StripeRefund {
  id: string;
  amount: number; // cents
  chargeId: string;
  status: "succeeded" | "pending" | "failed";
  createdAt: string;
}

export interface StripeDispute {
  id: string;
  amount: number; // cents
  chargeId: string;
  status: "needs_response" | "under_review" | "won" | "lost";
  createdAt: string;
}

export interface StripeSubscription {
  id: string;
  customerId: string;
  status: "active" | "past_due" | "canceled" | "trialing" | "paused";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  items: Array<{
    priceId: string;
    quantity: number;
    unitAmount: number; // cents
    interval: "month" | "year";
  }>;
  startDate: string;
}

export interface StripeInvoice {
  id: string;
  customerId: string;
  amount: number; // cents
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  createdAt: string;
}

export interface StripePaymentLink {
  id: string;
  url: string;
  amount: number; // cents
  active: boolean;
  createdAt: string;
}

export interface StripeBalanceTransaction {
  id: string;
  customerId: string;
  amount: number; // cents (negative = credit to customer)
  description: string;
  createdAt: string;
}

export interface CustomerPaymentHistory {
  charges: StripeCharge[];
  refunds: StripeRefund[];
  disputes: StripeDispute[];
}

export interface StripeProvider {
  // Read methods
  getCustomer(id: string): Promise<StripeCustomer>;
  searchCustomers(query: string): Promise<StripeCustomer[]>;
  getPaymentHistory(customerId: string): Promise<CustomerPaymentHistory>;
  getSubscription(id: string): Promise<StripeSubscription>;

  // Write methods
  createInvoice(customerId: string, amountCents: number, description: string): Promise<StripeInvoice>;
  voidInvoice(invoiceId: string): Promise<StripeInvoice>;
  createCharge(customerId: string, amountCents: number, currency: string, description: string): Promise<StripeCharge>;
  createRefund(chargeId: string, amountCents: number, reason: string): Promise<StripeRefund>;
  cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean): Promise<StripeSubscription>;
  modifySubscription(subscriptionId: string, changes: Record<string, unknown>): Promise<StripeSubscription>;
  createPaymentLink(amountCents: number, currency: string, description: string): Promise<StripePaymentLink>;
  deactivatePaymentLink(linkId: string): Promise<StripePaymentLink>;
  applyCredit(customerId: string, amountCents: number, description: string): Promise<StripeBalanceTransaction>;

  healthCheck(): Promise<ConnectionHealth>;
}

// ── Seeded test data ──

const SEED_CUSTOMERS: StripeCustomer[] = [
  {
    id: "cus_good_customer",
    name: "Alice Johnson",
    email: "alice@example.com",
    balance: 0,
    created: Date.now() / 1000 - 365 * 86400,
    metadata: {},
  },
  {
    id: "cus_frequent_refunder",
    name: "Bob Smith",
    email: "bob@example.com",
    balance: -5000, // $50 credit balance
    created: Date.now() / 1000 - 180 * 86400,
    metadata: {},
  },
  {
    id: "cus_disputed",
    name: "Charlie Brown",
    email: "charlie@example.com",
    balance: 0,
    created: Date.now() / 1000 - 90 * 86400,
    metadata: {},
  },
];

const SEED_CHARGES: StripeCharge[] = [
  {
    id: "ch_1",
    amount: 50000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_good_customer",
    disputed: false,
    refunded: false,
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: "ch_2",
    amount: 15000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_good_customer",
    disputed: false,
    refunded: false,
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
  },
  {
    id: "ch_3",
    amount: 20000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_frequent_refunder",
    disputed: false,
    refunded: true,
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
  },
  {
    id: "ch_4",
    amount: 10000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_frequent_refunder",
    disputed: false,
    refunded: true,
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
  },
  {
    id: "ch_5",
    amount: 25000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_frequent_refunder",
    disputed: false,
    refunded: true,
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: "ch_6",
    amount: 8000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_frequent_refunder",
    disputed: false,
    refunded: true,
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
  },
  {
    id: "ch_7",
    amount: 75000,
    currency: "usd",
    status: "succeeded",
    customerId: "cus_disputed",
    disputed: true,
    refunded: false,
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];

const SEED_REFUNDS: StripeRefund[] = [
  {
    id: "re_1",
    amount: 20000,
    chargeId: "ch_3",
    status: "succeeded",
    createdAt: new Date(Date.now() - 55 * 86400000).toISOString(),
  },
  {
    id: "re_2",
    amount: 10000,
    chargeId: "ch_4",
    status: "succeeded",
    createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
  },
  {
    id: "re_3",
    amount: 25000,
    chargeId: "ch_5",
    status: "succeeded",
    createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
  },
  {
    id: "re_4",
    amount: 8000,
    chargeId: "ch_6",
    status: "succeeded",
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
  },
];

const SEED_DISPUTES: StripeDispute[] = [
  {
    id: "dp_1",
    amount: 75000,
    chargeId: "ch_7",
    status: "needs_response",
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
];

const SEED_SUBSCRIPTIONS: StripeSubscription[] = [
  {
    id: "sub_1",
    customerId: "cus_good_customer",
    status: "active",
    currentPeriodStart: new Date(Date.now() - 15 * 86400000).toISOString(),
    currentPeriodEnd: new Date(Date.now() + 15 * 86400000).toISOString(),
    cancelAtPeriodEnd: false,
    items: [
      { priceId: "price_pro", quantity: 1, unitAmount: 4900, interval: "month" },
    ],
    startDate: new Date(Date.now() - 180 * 86400000).toISOString(),
  },
];

export class MockStripeProvider implements StripeProvider {
  private customers = new Map<string, StripeCustomer>();
  private charges = new Map<string, StripeCharge>();
  private refunds = new Map<string, StripeRefund>();
  private disputes = new Map<string, StripeDispute>();
  private subscriptions = new Map<string, StripeSubscription>();
  private invoices = new Map<string, StripeInvoice>();
  private paymentLinks = new Map<string, StripePaymentLink>();
  private balanceTransactions: StripeBalanceTransaction[] = [];
  private nextId = 100;

  constructor(_config: StripeConfig) {
    // Seed data
    for (const c of SEED_CUSTOMERS) this.customers.set(c.id, { ...c });
    for (const c of SEED_CHARGES) this.charges.set(c.id, { ...c });
    for (const r of SEED_REFUNDS) this.refunds.set(r.id, { ...r });
    for (const d of SEED_DISPUTES) this.disputes.set(d.id, { ...d });
    for (const s of SEED_SUBSCRIPTIONS) this.subscriptions.set(s.id, { ...s, items: s.items.map(item => ({ ...item })) });
  }

  private genId(prefix: string): string {
    return `${prefix}_mock_${this.nextId++}`;
  }

  async getCustomer(id: string): Promise<StripeCustomer> {
    const customer = this.customers.get(id);
    if (!customer) {
      // Return a default customer for unknown IDs (test convenience)
      return {
        id,
        name: `Customer ${id}`,
        email: `${id}@example.com`,
        balance: 0,
        created: Date.now() / 1000 - 30 * 86400,
        metadata: {},
      };
    }
    return { ...customer };
  }

  async searchCustomers(query: string): Promise<StripeCustomer[]> {
    const q = query.toLowerCase();
    return [...this.customers.values()].filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }

  async getPaymentHistory(customerId: string): Promise<CustomerPaymentHistory> {
    const charges = [...this.charges.values()].filter((c) => c.customerId === customerId);
    const chargeIds = new Set(charges.map((c) => c.id));
    const refunds = [...this.refunds.values()].filter((r) => chargeIds.has(r.chargeId));
    const disputes = [...this.disputes.values()].filter((d) => chargeIds.has(d.chargeId));
    return { charges, refunds, disputes };
  }

  async getSubscription(id: string): Promise<StripeSubscription> {
    const sub = this.subscriptions.get(id);
    if (!sub) {
      return {
        id,
        customerId: "cus_unknown",
        status: "active",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelAtPeriodEnd: false,
        items: [{ priceId: "price_default", quantity: 1, unitAmount: 2900, interval: "month" }],
        startDate: new Date(Date.now() - 90 * 86400000).toISOString(),
      };
    }
    return { ...sub };
  }

  async createInvoice(customerId: string, amountCents: number, description: string): Promise<StripeInvoice> {
    const invoice: StripeInvoice = {
      id: this.genId("in"),
      customerId,
      amount: amountCents,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    void description;
    this.invoices.set(invoice.id, invoice);
    return { ...invoice };
  }

  async voidInvoice(invoiceId: string): Promise<StripeInvoice> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      return { id: invoiceId, customerId: "cus_unknown", amount: 0, status: "void", createdAt: new Date().toISOString() };
    }
    invoice.status = "void";
    return { ...invoice };
  }

  async createCharge(customerId: string, amountCents: number, currency: string, description: string): Promise<StripeCharge> {
    const charge: StripeCharge = {
      id: this.genId("ch"),
      amount: amountCents,
      currency,
      status: "succeeded",
      customerId,
      disputed: false,
      refunded: false,
      createdAt: new Date().toISOString(),
    };
    void description;
    this.charges.set(charge.id, charge);
    return { ...charge };
  }

  async createRefund(chargeId: string, amountCents: number, reason: string): Promise<StripeRefund> {
    const refund: StripeRefund = {
      id: this.genId("re"),
      amount: amountCents,
      chargeId,
      status: "succeeded",
      createdAt: new Date().toISOString(),
    };
    void reason;
    this.refunds.set(refund.id, refund);
    // Mark charge as refunded
    const charge = this.charges.get(chargeId);
    if (charge) charge.refunded = true;
    return { ...refund };
  }

  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean): Promise<StripeSubscription> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      return {
        id: subscriptionId,
        customerId: "cus_unknown",
        status: "canceled",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date().toISOString(),
        cancelAtPeriodEnd,
        items: [],
        startDate: new Date().toISOString(),
      };
    }
    if (cancelAtPeriodEnd) {
      sub.cancelAtPeriodEnd = true;
    } else {
      sub.status = "canceled";
    }
    return { ...sub };
  }

  async modifySubscription(subscriptionId: string, changes: Record<string, unknown>): Promise<StripeSubscription> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      return {
        id: subscriptionId,
        customerId: "cus_unknown",
        status: "active",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancelAtPeriodEnd: false,
        items: [],
        startDate: new Date().toISOString(),
      };
    }
    // Apply simple changes
    if (typeof changes["quantity"] === "number" && sub.items[0]) {
      sub.items[0].quantity = changes["quantity"] as number;
    }
    if (typeof changes["priceId"] === "string" && sub.items[0]) {
      sub.items[0].priceId = changes["priceId"] as string;
    }
    return { ...sub };
  }

  async createPaymentLink(amountCents: number, currency: string, description: string): Promise<StripePaymentLink> {
    const link: StripePaymentLink = {
      id: this.genId("plink"),
      url: `https://pay.stripe.test/${this.nextId}`,
      amount: amountCents,
      active: true,
      createdAt: new Date().toISOString(),
    };
    void currency;
    void description;
    this.paymentLinks.set(link.id, link);
    return { ...link };
  }

  async deactivatePaymentLink(linkId: string): Promise<StripePaymentLink> {
    const link = this.paymentLinks.get(linkId);
    if (!link) {
      return { id: linkId, url: "", amount: 0, active: false, createdAt: new Date().toISOString() };
    }
    link.active = false;
    return { ...link };
  }

  async applyCredit(customerId: string, amountCents: number, description: string): Promise<StripeBalanceTransaction> {
    const txn: StripeBalanceTransaction = {
      id: this.genId("txn"),
      customerId,
      amount: -amountCents, // negative = credit to customer in Stripe
      description,
      createdAt: new Date().toISOString(),
    };
    this.balanceTransactions.push(txn);
    // Update customer balance
    const customer = this.customers.get(customerId);
    if (customer) {
      customer.balance -= amountCents;
    }
    return { ...txn };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return {
      status: "connected",
      latencyMs: 45,
      error: null,
      capabilities: [
        "payments.invoice.create",
        "payments.charge.create",
        "payments.refund.create",
        "payments.subscription.cancel",
        "payments.subscription.modify",
        "payments.link.create",
        "payments.credit.apply",
        "payments.batch.invoice",
      ],
    };
  }
}
