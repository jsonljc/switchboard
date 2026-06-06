// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a PSP webhook's HMAC over the RAW request body using
 * STRIPE_WEBHOOK_SECRET. Fails closed: a missing secret, missing/empty raw body,
 * or missing/mismatched signature all return false. Same fail-closed shape as
 * the ad-optimizer verifyMetaWebhookSignature; the provider-native signature
 * parser (Stripe t=,v1=) lives inside the 1A-4b adapter, not this edge.
 */
export function verifyPaymentWebhookSignature(
  rawBody: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    console.warn("[payments-webhook] verifyPaymentWebhookSignature called without a secret");
    return false;
  }
  if (!rawBody || typeof signature !== "string" || signature.length === 0) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const paymentsWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/payments/webhook", { config: { rawBody: true } }, async (request, reply) => {
    // Verify the HMAC over the raw body BEFORE trusting any payload field. The
    // org is resolved from the body below, which is forgeable without this gate.
    const rawBodyStr = (request as unknown as { rawBody?: string }).rawBody;
    const sigHeader = request.headers["x-payment-signature"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (
      !verifyPaymentWebhookSignature(rawBodyStr, signature, process.env["STRIPE_WEBHOOK_SECRET"])
    ) {
      app.log.warn("Payments webhook: signature verification failed");
      return reply.code(401).send({ error: "Invalid signature", statusCode: 401 });
    }

    // Org resolution + re-fetch + submit are added in Tasks 2-3.
    return reply.code(200).send({ received: true });
  });
};
