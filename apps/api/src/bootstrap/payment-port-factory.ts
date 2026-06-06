import type { PaymentPort } from "@switchboard/schemas";
import { NoopPaymentAdapter } from "./noop-payment-adapter.js";

export type PaymentPortFactory = (orgId: string) => Promise<PaymentPort>;

export interface PaymentPortFactoryDeps {
  // Matches the bootstrap logger shape used by calendar-provider-factory.ts.
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env at call sites
  // in PR 1A-4b when the Stripe branch lands.
  env?: {
    STRIPE_SECRET_KEY?: string;
    STRIPE_CONNECT_ACCOUNT_ID?: string;
  };
  // Optional override so tests can force a transient construction failure and
  // assert the rejected promise is evicted from the cache. Defaults to the
  // Noop resolver below.
  resolveForOrg?: (deps: PaymentPortFactoryDeps, orgId: string) => Promise<PaymentPort>;
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
  // Stripe Connect adapter lands in PR 1A-4b behind this same port. Until then
  // every org gets the Noop adapter (DEGRADED, never a T1 production paid visit).
  deps.logger.info(`Payment[${orgId}]: using NoopPaymentAdapter (Stripe Connect not configured)`);
  return new NoopPaymentAdapter();
}
