// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";

/**
 * Stripe Connect deposit settlement webhook (1A-4d). A platform-level Connect
 * endpoint receives `payment_intent.succeeded` events from every connected clinic
 * account, each carrying the connected account at the TOP-LEVEL `event.account`.
 * Verification is native (`constructEvent` over the `Stripe-Signature` header with
 * the platform Connect signing secret) via the `app.paymentWebhookVerifier` seam
 * (wired in app.ts from STRIPE_CONNECT_WEBHOOK_SECRET; distinct from the billing
 * STRIPE_WEBHOOK_SECRET). The amount is NEVER trusted from the body: the route
 * re-fetches the PaymentIntent by id and submits through ingress as a service actor
 * with a `psp-<eventId>` idempotency key (F3 money-authority, spec sec 9.4).
 */
export const paymentsWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/payments/webhook", { config: { rawBody: true } }, async (request, reply) => {
    // 1. Native signature verification over the RAW body BEFORE trusting any field.
    //    Absent verifier (Connect secret unconfigured) => fail closed with 503.
    const verifyEvent = app.paymentWebhookVerifier;
    if (!verifyEvent) {
      app.log.error("paymentWebhookVerifier not configured; cannot verify Stripe Connect event");
      return reply.code(503).send({ error: "Webhook verification unavailable", statusCode: 503 });
    }
    const rawBodyStr = (request as unknown as { rawBody?: string }).rawBody;
    const sigHeader = request.headers["stripe-signature"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!rawBodyStr || typeof signature !== "string" || signature.length === 0) {
      return reply.code(401).send({ error: "Missing signature", statusCode: 401 });
    }
    let event: ReturnType<typeof verifyEvent>;
    try {
      event = verifyEvent(rawBodyStr, signature);
    } catch (err) {
      app.log.warn({ err }, "Payments webhook: Stripe signature verification failed");
      return reply.code(401).send({ error: "Invalid signature", statusCode: 401 });
    }

    // 2. Only payment_intent.succeeded settles a deposit. After this guard the event
    //    narrows so data.object is the PaymentIntent: data.object.id is the PI id the
    //    re-fetch needs and the bookingId lives in its metadata (set at
    //    createDepositLink via payment_intent_data.metadata). checkout.session.completed
    //    / charge.succeeded carry a session/charge id at data.object.id (not a PI id),
    //    so they are acknowledged but ignored (one endpoint receives many event types).
    if (event.type !== "payment_intent.succeeded") {
      return reply.code(200).send({ received: true, skipped: true, reason: "ignored_event_type" });
    }

    // 3. Connect routing: the connected account is the TOP-LEVEL event.account on a
    //    platform Connect endpoint (NOT data.object.account). providerMessageId is the
    //    Stripe event id (drives idempotency); chargeId is the PaymentIntent id.
    const providerMessageId = event.id;
    const connectedAccountId = event.account;
    const chargeId = event.data.object.id;
    if (!connectedAccountId) {
      app.log.warn({ providerMessageId }, "Connect event missing top-level account; skipping");
      return reply.code(200).send({ received: true, skipped: true, reason: "no_account" });
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

    // Per-org fetch-back. Fail closed if the factory is not wired rather than
    // trusting the body amount.
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

    // Only a settled charge becomes a verified payment. A not-yet-paid charge is
    // acknowledged but not recorded; a later paid event re-fetches and records it.
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

    // Server-side booking lookup to resolve contact/opportunity. The booking row is
    // the authoritative join. Never read contactId/opportunityId from the webhook
    // body (forgeable) or the charge metadata (not stored there). Scoping by
    // organizationId is the cross-tenant guard: a mismatched account/org finds no row.
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

    // Submit the verified writer through ingress. idempotencyKey from the Stripe event
    // id => a redelivery is deduped at PlatformIngress (platform-ingress.ts). The
    // amount is the RE-FETCHED amountCents; provider is carried so the handler can
    // degrade a Noop provider. contactId/opportunityId/bookingId are resolved
    // server-side from the Booking row (never from the body).
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
