import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { createPaymentPortFactory } from "../payment-port-factory.js";
import { isNoopPaymentAdapter } from "../noop-payment-adapter.js";
import { StripeConnectPaymentAdapter } from "../../payments/stripe-connect-payment-adapter.js";
import type { StripeConnectClient } from "../../payments/stripe-connect-payment-adapter.js";

const silentLogger = { info: () => {}, error: () => {} };

describe("createPaymentPortFactory: input validation", () => {
  it("rejects with ORG_ID_REQUIRED when orgId is empty string", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger });
    await expect(factory("")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });

  it("rejects with ORG_ID_REQUIRED when orgId is whitespace-only", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger });
    await expect(factory("   ")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });
});

describe("createPaymentPortFactory: Noop fallback", () => {
  it("returns NoopPaymentAdapter when no Stripe env is configured", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger });
    expect(isNoopPaymentAdapter(await factory("org-A"))).toBe(true);
  });
});

describe("createPaymentPortFactory: memoization", () => {
  it("returns the same Promise for the same orgId across calls", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger });
    const p1 = factory("org-A");
    const p2 = factory("org-A");
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
  });

  it("returns independent ports for different orgIds", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger });
    const [a, b] = await Promise.all([factory("org-A"), factory("org-B")]);
    expect(a).not.toBe(b);
  });
});

describe("createPaymentPortFactory: rejection eviction", () => {
  it("clears a rejected construction so a later call can retry", async () => {
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient init failure");
      const { NoopPaymentAdapter } = await import("../noop-payment-adapter.js");
      return new NoopPaymentAdapter();
    });
    const factory = createPaymentPortFactory({
      logger: silentLogger,
      resolveForOrg: resolver,
    });
    await expect(factory("org-A")).rejects.toThrow(/transient init failure/);
    const port = await factory("org-A");
    expect(isNoopPaymentAdapter(port)).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by the Stripe Connect selection tests
// ---------------------------------------------------------------------------

function makePrismaWithConnection(
  connectionByOrg: Record<
    string,
    { id: string; credentials: unknown; externalAccountId: string | null } | null
  >,
) {
  return {
    connection: {
      findFirst: vi.fn(
        async ({ where }: { where: { organizationId: string; serviceId: string } }) =>
          connectionByOrg[where.organizationId] ?? null,
      ),
    },
  };
}

function fakeStripeClient() {
  return {
    checkout: { sessions: { create: () => {} } },
    paymentIntents: { retrieve: () => {} },
    webhooks: { constructEvent: () => {} },
  };
}

describe("createPaymentPortFactory: Stripe Connect selection", () => {
  it("returns a StripeConnectPaymentAdapter for full creds with NO per-org webhookSecret when externalAccountId matches", async () => {
    const prisma = makePrismaWithConnection({
      "org-stripe": { id: "conn_1", credentials: "enc", externalAccountId: "acct_1" },
    });
    const decryptCredentials = vi.fn(() => ({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      // deliberately NO webhookSecret — post-#984 the platform secret verifies webhooks.
    }));
    const stripeClientFactory = vi.fn(() => fakeStripeClient());
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      decryptCredentials,
      stripeClientFactory: stripeClientFactory as never,
    });

    const port = await factory("org-stripe");

    expect(port).toBeInstanceOf(StripeConnectPaymentAdapter);
    expect(isNoopPaymentAdapter(port)).toBe(false);
    // Cross-org isolation: the Connection lookup is org-scoped.
    expect(prisma.connection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-stripe",
          serviceId: "stripe",
        }),
      }),
    );
    // The per-org secret built the client (never a global env secret).
    expect(stripeClientFactory).toHaveBeenCalledWith("sk_live_x");
  });

  it("returns the Noop adapter when the org has no 'stripe' Connection", async () => {
    const prisma = makePrismaWithConnection({ "org-none": null });
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(),
      stripeClientFactory: vi.fn() as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-none"))).toBe(true);
  });

  it("returns the Noop adapter when Connect creds are partial (fail-closed)", async () => {
    const prisma = makePrismaWithConnection({
      "org-partial": { id: "conn_2", credentials: "enc", externalAccountId: "acct" },
    });
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      // missing secretKey -> parser returns null -> Noop
      decryptCredentials: vi.fn(() => ({ connectedAccountId: "acct" })),
      stripeClientFactory: vi.fn() as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-partial"))).toBe(true);
  });

  it("returns Noop when externalAccountId disagrees with credentials.connectedAccountId (fail-closed; settlement would not resolve)", async () => {
    const prisma = makePrismaWithConnection({
      "org-mismatch": { id: "conn_3", credentials: "enc", externalAccountId: "acct_1" },
    });
    const stripeClientFactory = vi.fn(() => fakeStripeClient());
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(() => ({ connectedAccountId: "acct_2", secretKey: "sk_live_x" })),
      stripeClientFactory: stripeClientFactory as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-mismatch"))).toBe(true);
    // Never build a live client when the account the adapter would act on is not the
    // one the settlement webhook resolves the org by.
    expect(stripeClientFactory).not.toHaveBeenCalled();
  });

  it("returns Noop when the Connection has no externalAccountId even with full creds (settlement cannot resolve)", async () => {
    const prisma = makePrismaWithConnection({
      "org-noext": { id: "conn_4", credentials: "enc", externalAccountId: null },
    });
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(() => ({ connectedAccountId: "acct_1", secretKey: "sk_live_x" })),
      stripeClientFactory: vi.fn() as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-noext"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Redirect URL wiring helpers
// ---------------------------------------------------------------------------

function recordingStripeClient(): {
  createParams: Stripe.Checkout.SessionCreateParams[];
  client: StripeConnectClient;
} {
  const createParams: Stripe.Checkout.SessionCreateParams[] = [];
  const client = {
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          createParams.push(params);
          return { url: "https://checkout.stripe.test/c/sess_1", payment_intent: "pi_1" };
        },
      },
    },
    paymentIntents: { retrieve: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  } as unknown as StripeConnectClient;
  return { createParams, client };
}

function provisionedPrisma() {
  return makePrismaWithConnection({
    "org-stripe": { id: "conn_1", credentials: "enc", externalAccountId: "acct_1" },
  });
}

const liveCreds = () => ({ connectedAccountId: "acct_1", secretKey: "sk_live_x" });

describe("createPaymentPortFactory: redirect URL wiring", () => {
  it("issues a deposit link whose success_url/cancel_url derive from the configured base URL", async () => {
    const { createParams, client } = recordingStripeClient();
    const factory = createPaymentPortFactory({
      prismaClient: provisionedPrisma() as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(liveCreds),
      stripeClientFactory: () => client,
      paymentRedirectBaseUrl: "https://app.example.com",
    });

    const port = await factory("org-stripe");
    await port.createDepositLink({
      bookingId: "bk_1",
      organizationId: "org-stripe",
      amountCents: 5000,
      currency: "SGD",
    });

    expect(createParams).toHaveLength(1);
    expect(createParams[0]?.success_url).toBe("https://app.example.com/payment/success");
    expect(createParams[0]?.cancel_url).toBe("https://app.example.com/payment/cancel");
    // The dead placeholder domain is gone for good.
    expect(JSON.stringify(createParams[0])).not.toContain("switchboard.local");
  });

  it("normalizes a trailing slash on the base URL (no double slash)", async () => {
    const { createParams, client } = recordingStripeClient();
    const factory = createPaymentPortFactory({
      prismaClient: provisionedPrisma() as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(liveCreds),
      stripeClientFactory: () => client,
      paymentRedirectBaseUrl: "https://app.example.com/",
    });

    const port = await factory("org-stripe");
    await port.createDepositLink({
      bookingId: "bk_2",
      organizationId: "org-stripe",
      amountCents: 5000,
      currency: "SGD",
    });

    expect(createParams[0]?.success_url).toBe("https://app.example.com/payment/success");
    expect(createParams[0]?.cancel_url).toBe("https://app.example.com/payment/cancel");
  });

  it("falls back to the localhost dev default when no base URL is injected", async () => {
    const { createParams, client } = recordingStripeClient();
    const factory = createPaymentPortFactory({
      prismaClient: provisionedPrisma() as never,
      logger: silentLogger,
      decryptCredentials: vi.fn(liveCreds),
      stripeClientFactory: () => client,
    });

    const port = await factory("org-stripe");
    await port.createDepositLink({
      bookingId: "bk_3",
      organizationId: "org-stripe",
      amountCents: 5000,
      currency: "SGD",
    });

    expect(createParams[0]?.success_url).toBe("http://localhost:3002/payment/success");
    expect(createParams[0]?.cancel_url).toBe("http://localhost:3002/payment/cancel");
  });
});
