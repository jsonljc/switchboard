import { describe, it, expect, vi } from "vitest";
import { createPaymentPortFactory } from "../payment-port-factory.js";
import { isNoopPaymentAdapter } from "../noop-payment-adapter.js";
import { StripeConnectPaymentAdapter } from "../../payments/stripe-connect-payment-adapter.js";

const silentLogger = { info: () => {}, error: () => {} };

describe("createPaymentPortFactory: input validation", () => {
  it("rejects with ORG_ID_REQUIRED when orgId is empty string", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    await expect(factory("")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });

  it("rejects with ORG_ID_REQUIRED when orgId is whitespace-only", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    await expect(factory("   ")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });
});

describe("createPaymentPortFactory: Noop fallback", () => {
  it("returns NoopPaymentAdapter when no Stripe env is configured", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    expect(isNoopPaymentAdapter(await factory("org-A"))).toBe(true);
  });
});

describe("createPaymentPortFactory: memoization", () => {
  it("returns the same Promise for the same orgId across calls", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
    const p1 = factory("org-A");
    const p2 = factory("org-A");
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
  });

  it("returns independent ports for different orgIds", async () => {
    const factory = createPaymentPortFactory({ logger: silentLogger, env: {} });
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
      env: {},
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
  connectionByOrg: Record<string, { id: string; credentials: unknown } | null>,
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
  it("returns a StripeConnectPaymentAdapter when a connected 'stripe' Connection with full creds exists", async () => {
    const prisma = makePrismaWithConnection({
      "org-stripe": { id: "conn_1", credentials: "enc" },
    });
    const decryptCredentials = vi.fn(() => ({
      connectedAccountId: "acct_1",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_x",
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
      "org-partial": { id: "conn_2", credentials: "enc" },
    });
    const factory = createPaymentPortFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      // missing webhookSecret -> parser returns null -> Noop
      decryptCredentials: vi.fn(() => ({ connectedAccountId: "acct", secretKey: "sk" })),
      stripeClientFactory: vi.fn() as never,
    });

    expect(isNoopPaymentAdapter(await factory("org-partial"))).toBe(true);
  });
});
