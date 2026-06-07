import type { PaymentPort } from "@switchboard/schemas";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Per-org PaymentPort factory (1A-4a). Resolves the org's configured PSP
     * adapter (Noop -> Stripe Connect) for fetch-back. Decorated in app.ts by
     * 1A-4a; optional so this route can 503 cleanly before that wiring lands.
     */
    paymentPortFactory?: (orgId: string) => Promise<PaymentPort>;
  }
}
