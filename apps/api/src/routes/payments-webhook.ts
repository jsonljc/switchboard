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

    // Parse the verified body. Shape is the PSP event envelope; we only read the
    // ids and the connected-account id needed to route — NEVER the amount.
    const payload = request.body as {
      id?: string;
      data?: { object?: { id?: string; account?: string } };
    };
    const providerMessageId = payload.id;
    const chargeId = payload.data?.object?.id;
    const connectedAccountId = payload.data?.object?.account;
    if (!providerMessageId || !chargeId || !connectedAccountId) {
      return reply.code(200).send({ received: true, skipped: true, reason: "unparseable" });
    }

    // Resolve org AFTER verification, from the connected-account id. serviceId is
    // pinned to "stripe" so a forged account id cannot cross services.
    let organizationId: string | null = null;
    if (app.prisma) {
      const connection = await app.prisma.connection.findFirst({
        where: { serviceId: "stripe", externalAccountId: connectedAccountId },
      });
      organizationId = connection?.organizationId ?? null;
    }
    if (!organizationId) {
      app.log.warn({ connectedAccountId }, "No org for payments webhook account, skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "no_org" });
    }

    // Per-org fetch-back. Fail closed if the factory is not wired (1A-4a) rather
    // than trusting the body amount.
    if (!app.paymentPortFactory) {
      app.log.error("paymentPortFactory not configured; cannot verify charge");
      return reply.code(503).send({ error: "Payment verification unavailable", statusCode: 503 });
    }
    const port = await app.paymentPortFactory(organizationId);
    const charge = await port.retrievePayment(chargeId);
    if (!charge) {
      app.log.warn({ chargeId }, "Charge not found on re-fetch; skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "charge_not_found" });
    }

    // Only a settled charge becomes a verified payment. A not-yet-paid charge
    // (e.g. a payment_intent.created/processing event) is acknowledged but not
    // recorded — a later "paid" event re-fetches and records it. This keeps the
    // record_verified handler's paid-only invariant from turning a normal event
    // into a 500/retry storm.
    if (charge.status !== "paid") {
      app.log.info({ chargeId, status: charge.status }, "Charge not paid yet; skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "charge_not_paid" });
    }

    // A charge with no PSP-metadata booking linkage cannot be attributed to a
    // contact or opportunity. 200-skip so redeliveries don't error-storm (never 500).
    if (!charge.bookingId) {
      app.log.warn({ chargeId }, "Charge carries no bookingId in metadata; skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "no_booking_linkage" });
    }

    // Server-side booking lookup to resolve contact/opportunity. The booking
    // row is the authoritative join — never read contactId/opportunityId from
    // the webhook body (forgeable) or the charge metadata (not stored there).
    const booking = app.prisma
      ? await app.prisma.booking.findFirst({
          where: { id: charge.bookingId, organizationId },
          select: { contactId: true, opportunityId: true },
        })
      : null;
    if (!booking || !booking.contactId || !booking.opportunityId) {
      app.log.warn({ bookingId: charge.bookingId }, "Booking not resolvable for payment; skipping");
      return reply
        .code(200)
        .send({ received: true, skipped: true, reason: "booking_not_resolvable" });
    }

    // Submit the verified writer through ingress. idempotencyKey from the provider
    // message id => a replay is deduped at PlatformIngress (platform-ingress.ts).
    // The amount is the RE-FETCHED amountCents; provider is carried so the 1A-4b
    // handler can degrade a Noop provider (R1). contactId/opportunityId/bookingId
    // are resolved server-side from the Booking row (never from the body).
    const result = await app.platformIngress.submit({
      intent: "payment.record_verified",
      parameters: {
        contactId: booking.contactId,
        opportunityId: booking.opportunityId,
        bookingId: charge.bookingId,
        externalReference: charge.externalReference,
        amountCents: charge.amountCents,
        currency: charge.currency,
        provider: charge.provider,
      },
      actor: { id: "system", type: "service" },
      organizationId,
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey: `psp-${providerMessageId}`,
    });

    if (!result.ok) {
      app.log.error({ error: result.error }, "payment.record_verified submission failed");
      return reply.code(500).send({ error: result.error.message, statusCode: 500 });
    }
    return reply.code(200).send({
      received: true,
      workUnitId: result.workUnit.id,
      traceId: result.workUnit.traceId,
    });
  });
};
