import type { PaymentPort } from "@switchboard/schemas";
import type Stripe from "stripe";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Per-org PaymentPort factory (1A-4a). Resolves the org's configured PSP
     * adapter (Noop -> Stripe Connect) for fetch-back. Decorated in app.ts by
     * 1A-4a; optional so this route can 503 cleanly before that wiring lands.
     */
    paymentPortFactory?: (orgId: string) => Promise<PaymentPort>;
    /**
     * Native Stripe Connect webhook verifier (platform-level endpoint, 1A-4d).
     * Verifies the Stripe-Signature over the raw body with the platform Connect
     * signing secret and returns the typed event (event.account = connected
     * account). Decorated in app.ts only when STRIPE_SECRET_KEY +
     * STRIPE_CONNECT_WEBHOOK_SECRET are set; the payments webhook route 503s when
     * absent (fail-closed). Throws on a tampered/forged signature.
     */
    paymentWebhookVerifier?: (rawBody: string | Buffer, signature: string) => Stripe.Event;
  }
}
