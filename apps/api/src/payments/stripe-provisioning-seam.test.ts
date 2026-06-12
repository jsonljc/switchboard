// CREDENTIALS_ENCRYPTION_KEY is read at CALL time by @switchboard/db's encrypt/decrypt
// (credentials.ts:27,57), not at import. Set it at module scope (before any test runs) so the
// real-crypto round-trip is unambiguous regardless of the caller's env; ??= respects an
// already-set key (round-trip only needs key CONSISTENCY).
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "test-encryption-key-at-least-32-characters-long!!";

import { describe, it, expect, vi } from "vitest";
import { PrismaConnectionStore } from "@switchboard/db";
import { createPaymentPortFactory } from "../bootstrap/payment-port-factory.js";
import { isNoopPaymentAdapter } from "../bootstrap/noop-payment-adapter.js";
import { StripeConnectPaymentAdapter } from "./stripe-connect-payment-adapter.js";

const silentLogger = { info: () => {}, error: () => {} };

function fakeStripeClient() {
  return {
    checkout: { sessions: { create: () => {} } },
    paymentIntents: { retrieve: () => {} },
    webhooks: { constructEvent: () => {} },
  };
}

describe("stripe provisioning -> payment factory seam", () => {
  it("a connection provisioned by the writer resolves to the live StripeConnectPaymentAdapter", async () => {
    // PRODUCER: run the real db writer against a mock Prisma, capturing the upserted row.
    let captured: { credentials: string; externalAccountId: string } | null = null;
    const writerPrisma = {
      connection: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(
          async ({
            create,
          }: {
            create: { id: string; credentials: string; externalAccountId: string };
          }) => {
            captured = {
              credentials: create.credentials,
              externalAccountId: create.externalAccountId,
            };
            return { id: create.id };
          },
        ),
      },
    };
    const store = new PrismaConnectionStore(writerPrisma as never);
    await store.provisionStripeConnection({
      organizationId: "org_seam",
      connectedAccountId: "acct_seam123",
      secretKey: "sk_test_seam",
    });
    expect(captured).not.toBeNull();
    // Producer-side invariant made explicit at the seam: externalAccountId === connectedAccountId.
    expect(captured!.externalAccountId).toBe("acct_seam123");

    // CONSUMER: feed the captured row into the #999 factory with the DEFAULT (real) decrypt.
    const stripeClientFactory = vi.fn(() => fakeStripeClient());
    const factoryPrisma = {
      connection: {
        // Honor the factory's WHERE so the seam also pins the writer's serviceId/status to what
        // the factory queries for: a row written with status != "connected" or serviceId !=
        // "stripe" would not be found and would fall through to Noop.
        findFirst: vi.fn(async ({ where }: { where: { serviceId: string; status: string } }) =>
          where.serviceId === "stripe" && where.status === "connected"
            ? {
                id: "conn_seam",
                credentials: captured!.credentials,
                externalAccountId: captured!.externalAccountId,
              }
            : null,
        ),
      },
    };
    const factory = createPaymentPortFactory({
      prismaClient: factoryPrisma as never,
      logger: silentLogger,
      stripeClientFactory: stripeClientFactory as never,
      // No decryptCredentials override -> uses @switchboard/db's real decrypt, round-tripping
      // the writer's real encrypt.
    });

    const port = await factory("org_seam");
    expect(port).toBeInstanceOf(StripeConnectPaymentAdapter);
    expect(isNoopPaymentAdapter(port)).toBe(false);
    expect(stripeClientFactory).toHaveBeenCalledWith("sk_test_seam");
  });

  it("an org with no provisioned stripe connection stays fail-closed on Noop", async () => {
    const factory = createPaymentPortFactory({
      prismaClient: { connection: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      logger: silentLogger,
    });
    expect(isNoopPaymentAdapter(await factory("org_unprovisioned"))).toBe(true);
  });
});
