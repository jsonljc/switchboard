// Registered at server startup in app.ts (PR 1A-4d) inside `if (prismaClient)` and exposed as
// `app.paymentPortFactory`, which the payments webhook resolves charges through. Selects the
// Stripe Connect adapter when the org has a connected `stripe` Connection with full per-org
// creds, else returns Noop (fail-closed — never a global env secret).
import Stripe from "stripe";
import type { PaymentPort } from "@switchboard/schemas";
import { decryptCredentials as defaultDecryptCredentials } from "@switchboard/db";
import { NoopPaymentAdapter } from "./noop-payment-adapter.js";
import {
  StripeConnectPaymentAdapter,
  type StripeConnectClient,
} from "../payments/stripe-connect-payment-adapter.js";
import { parseStripeConnectCredentials } from "../payments/stripe-connect-credentials.js";

export type PaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

export interface PaymentPortFactoryDeps {
  // Matches the bootstrap logger shape used by calendar-provider-factory.ts.
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional override so tests can force a transient construction failure and
  // assert the rejected promise is evicted from the cache. Defaults to the
  // Noop resolver below.
  resolveForOrg?: (deps: PaymentPortFactoryDeps, orgId: string) => Promise<PaymentPort>;
  // Optional Prisma client for per-org Connection lookup (1A-4d). When absent
  // the factory falls back to Noop for all orgs.
  prismaClient?: {
    connection: {
      findFirst(args: {
        where: { organizationId: string; serviceId: string; status: string };
        select: { id: boolean; credentials: boolean };
      }): Promise<{ id: string; credentials: unknown } | null>;
    };
  };
  // Optional injectable decryptCredentials for tests. Defaults to @switchboard/db's
  // decryptCredentials — the same adapter pattern used by ads-client-factory.ts.
  decryptCredentials?: (encrypted: unknown) => Record<string, unknown>;
  // Optional injectable Stripe client factory for tests. Defaults to a real new
  // Stripe(secretKey, { apiVersion }) constructor matching stripe-service.ts:13.
  stripeClientFactory?: (secretKey: string) => StripeConnectClient;
}

export function createPaymentPortFactory(deps: PaymentPortFactoryDeps): PaymentPortFactory {
  // No eviction in beta (~10 orgs), mirroring calendar-provider-factory.ts.
  const cache = new Map<string, Promise<PaymentPort>>();
  const resolve = deps.resolveForOrg ?? resolveForOrg;

  const factory: PaymentPortFactory = (orgId: string) => {
    if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
      return Promise.reject(new Error("ORG_ID_REQUIRED"));
    }

    const existing = cache.get(orgId);
    if (existing) return existing;

    const promise = resolve(deps, orgId).catch((error) => {
      cache.delete(orgId);
      throw error;
    });

    cache.set(orgId, promise);
    return promise;
  };

  return factory;
}

async function resolveForOrg(deps: PaymentPortFactoryDeps, orgId: string): Promise<PaymentPort> {
  // Stripe-first: query the org's connected 'stripe' Connection. Fail-closed —
  // partial creds or no Connection fall through to Noop (never a global env secret).
  // Mirrors the pattern from ads-client-factory.ts + meta-spend-provider.ts.
  const decrypt =
    deps.decryptCredentials ??
    ((encrypted: unknown) => defaultDecryptCredentials(encrypted as string));

  const buildStripeClient =
    deps.stripeClientFactory ??
    ((secretKey: string): StripeConnectClient =>
      new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" }) as unknown as StripeConnectClient);

  if (deps.prismaClient) {
    const connection = await deps.prismaClient.connection.findFirst({
      where: { organizationId: orgId, serviceId: "stripe", status: "connected" },
      select: { id: true, credentials: true },
    });

    if (connection) {
      const creds = parseStripeConnectCredentials(decrypt(connection.credentials));
      if (creds) {
        deps.logger.info(
          `Payment[${orgId}]: using StripeConnectPaymentAdapter (connected account)`,
        );
        return new StripeConnectPaymentAdapter({
          client: buildStripeClient(creds.secretKey),
          connectedAccountId: creds.connectedAccountId,
          // GO-LIVE: replace these placeholders with the org's real success/cancel redirect
          // URLs before enabling a live Stripe Connection. Inert until then — deposit-link
          // issuance is deferred; the live webhook path uses only retrievePayment, which
          // never reads these.
          successUrl: "https://switchboard.local/payment/success",
          cancelUrl: "https://switchboard.local/payment/cancel",
        });
      }
      deps.logger.info(
        `Payment[${orgId}]: 'stripe' Connection present but Connect creds incomplete — using Noop (fail-closed)`,
      );
    }
  }

  // Fall through to Noop — every org that lacks a connected Stripe Connection gets a
  // DEGRADED (T3) noop payment posture that is never a production-countable paid visit.
  deps.logger.info(`Payment[${orgId}]: using NoopPaymentAdapter (Stripe Connect not configured)`);
  return new NoopPaymentAdapter();
}
