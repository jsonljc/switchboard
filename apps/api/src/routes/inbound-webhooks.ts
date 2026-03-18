// ---------------------------------------------------------------------------
// Inbound Webhook Receivers — Stripe events + lead capture forms
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger } from "../logger.js";
import { executeGovernedSystemAction } from "../services/system-governed-actions.js";

const logger = createLogger("inbound-webhooks");

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const inboundWebhooksRoutes: FastifyPluginAsync = async (app) => {
  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/inbound/stripe — Receive Stripe webhook events
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/stripe",
    {
      schema: {
        description: "Receive and process Stripe webhook events with signature verification.",
        tags: ["Inbound Webhooks"],
      },
      config: {
        // Need raw body for signature verification
        rawBody: true,
      },
    },
    async (request, reply) => {
      const stripeSignature = request.headers["stripe-signature"] as string | undefined;
      const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

      if (!stripeSignature) {
        return reply.code(400).send({ error: "Missing Stripe-Signature header" });
      }

      if (!webhookSecret) {
        logger.warn("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
        return reply.code(500).send({ error: "Webhook secret not configured" });
      }

      // Verify Stripe signature
      const rawBody =
        typeof request.body === "string" ? request.body : JSON.stringify(request.body);

      if (!verifyStripeSignature(rawBody, stripeSignature, webhookSecret)) {
        logger.warn("Invalid Stripe webhook signature");
        return reply.code(401).send({ error: "Invalid signature" });
      }

      const event = request.body as {
        id: string;
        type: string;
        data: { object: Record<string, unknown> };
        created: number;
      };

      logger.info({ eventId: event.id, eventType: event.type }, "Received Stripe webhook event");

      try {
        await handleStripeEvent(app, event);
        return reply.code(200).send({ received: true, eventId: event.id });
      } catch (err) {
        logger.error({ err, eventId: event.id }, "Error processing Stripe webhook");
        // Return 200 to prevent Stripe retries for processing errors
        // (we log the error and can reprocess from the DLQ)
        return reply.code(200).send({ received: true, eventId: event.id, processingError: true });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/inbound/forms — Receive lead capture form submissions
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/forms",
    {
      schema: {
        description:
          "Receive lead capture form submissions from Facebook Lead Ads, Typeform, or custom forms.",
        tags: ["Inbound Webhooks"],
        body: {
          type: "object",
          properties: {
            source: {
              type: "string",
              enum: ["facebook", "typeform", "custom", "instagram", "google"],
            },
            formId: { type: "string" },
            submittedAt: { type: "string" },
            fields: {
              type: "object",
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                serviceInterest: { type: "string" },
                message: { type: "string" },
              },
            },
          },
          required: ["source", "fields"],
        },
      },
    },
    async (request, reply) => {
      const submission = request.body as {
        source: string;
        formId?: string;
        submittedAt?: string;
        fields: {
          firstName?: string;
          lastName?: string;
          email?: string;
          phone?: string;
          serviceInterest?: string;
          message?: string;
        };
        // Facebook-specific fields
        leadgen_id?: string;
        page_id?: string;
        // Optional HMAC verification
        signature?: string;
      };

      // Verify Facebook webhook signature if present
      if (submission.source === "facebook" && submission.signature) {
        const fbAppSecret = process.env["FACEBOOK_APP_SECRET"];
        if (fbAppSecret) {
          const rawBody = JSON.stringify(request.body);
          const expectedSig = createHmac("sha256", fbAppSecret).update(rawBody).digest("hex");
          const sigBuffer = Buffer.from(submission.signature);
          const expectedBuffer = Buffer.from(`sha256=${expectedSig}`);
          if (
            sigBuffer.length !== expectedBuffer.length ||
            !timingSafeEqual(sigBuffer, expectedBuffer)
          ) {
            return reply.code(401).send({ error: "Invalid Facebook signature" });
          }
        }
      }

      const leadId = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      logger.info(
        {
          leadId,
          source: submission.source,
          hasEmail: !!submission.fields.email,
          serviceInterest: submission.fields.serviceInterest,
        },
        "Received form submission",
      );

      try {
        await handleFormSubmission(app, leadId, submission);

        return reply.code(200).send({
          received: true,
          leadId,
          source: submission.source,
        });
      } catch (err) {
        logger.error({ err, leadId }, "Error processing form submission");
        return reply.code(200).send({
          received: true,
          leadId,
          processingError: true,
        });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/inbound/booking-confirmed — Receive booking confirmations
  // from Calendly, Setmore, or custom booking systems
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/booking-confirmed",
    {
      schema: {
        description:
          "Receive booking confirmation webhooks from external booking systems (Calendly, Setmore, custom).",
        tags: ["Inbound Webhooks"],
        body: {
          type: "object",
          properties: {
            leadId: { type: "string", description: "Lead attribution ID from booking URL" },
            contactExternalId: {
              type: "string",
              description: "Channel sender ID (e.g. WhatsApp phone number)",
            },
            bookingId: { type: "string", description: "External booking system ID" },
            service: { type: "string", description: "Service/treatment booked" },
            provider: { type: "string", description: "Provider/staff name" },
            scheduledAt: {
              type: "string",
              format: "date-time",
              description: "Appointment date/time",
            },
            source: {
              type: "string",
              enum: ["calendly", "setmore", "acuity", "custom"],
              description: "Booking platform source",
            },
            organizationId: { type: "string" },
          },
          required: ["bookingId", "source"],
        },
      },
    },
    async (request, reply) => {
      // HMAC signature verification
      const bookingWebhookSecret = process.env["BOOKING_WEBHOOK_SECRET"];
      if (bookingWebhookSecret) {
        const signature = request.headers["x-webhook-signature"] as string | undefined;
        if (!signature) {
          return reply.code(401).send({ error: "Missing x-webhook-signature header" });
        }
        const rawBody =
          typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        const expectedSig = createHmac("sha256", bookingWebhookSecret)
          .update(rawBody)
          .digest("hex");
        const sigBuf = Buffer.from(signature);
        const expectedBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
          logger.warn("Invalid booking webhook signature");
          return reply.code(401).send({ error: "Invalid signature" });
        }
      }

      const booking = request.body as {
        leadId?: string;
        contactExternalId?: string;
        bookingId: string;
        service?: string;
        provider?: string;
        scheduledAt?: string;
        source: string;
        organizationId?: string;
      };

      logger.info(
        {
          bookingId: booking.bookingId,
          source: booking.source,
          leadId: booking.leadId,
          service: booking.service,
        },
        "Received booking confirmation",
      );

      try {
        await handleBookingConfirmation(app, booking);
        return reply.code(200).send({
          received: true,
          bookingId: booking.bookingId,
        });
      } catch (err) {
        logger.error(
          { err, bookingId: booking.bookingId },
          "Error processing booking confirmation",
        );
        return reply.code(200).send({
          received: true,
          bookingId: booking.bookingId,
          processingError: true,
        });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/inbound/revenue — Receive revenue events from external systems
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/revenue",
    {
      schema: {
        description:
          "Receive revenue events from external systems (POS, CRM, custom) with HMAC verification.",
        tags: ["Inbound Webhooks"],
      },
    },
    async (request, reply) => {
      const webhookSecret = process.env["REVENUE_WEBHOOK_SECRET"];
      if (!webhookSecret) {
        logger.warn("REVENUE_WEBHOOK_SECRET not configured — rejecting webhook");
        return reply.code(500).send({ error: "Webhook secret not configured" });
      }

      // Verify HMAC signature
      const signature = request.headers["x-switchboard-signature"] as string | undefined;
      if (!signature) {
        return reply.code(401).send({ error: "Missing X-Switchboard-Signature header" });
      }

      const rawBody =
        typeof request.body === "string" ? request.body : JSON.stringify(request.body);
      const expectedSig = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

      if (!timingSafeCompare(signature, expectedSig)) {
        logger.warn("Invalid revenue webhook signature");
        return reply.code(401).send({ error: "Invalid signature" });
      }

      // Validate payload against RevenueEventSchema
      const { RevenueEventSchema } = await import("@switchboard/schemas");
      const parseResult = RevenueEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ error: parseResult.error.format() });
      }

      const event = parseResult.data;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      // Look up organization from header
      const orgId = request.headers["x-organization-id"] as string | undefined;
      if (!orgId) {
        return reply.code(400).send({ error: "Missing X-Organization-Id header" });
      }

      // Look up contact
      const contact = await app.prisma.crmContact.findFirst({
        where: { id: event.contactId, organizationId: orgId },
        select: { id: true, sourceAdId: true, sourceCampaignId: true },
      });

      if (!contact) {
        return reply.code(404).send({ error: "Contact not found" });
      }

      const eventTimestamp = event.timestamp ? new Date(event.timestamp) : new Date();

      // Persist revenue event
      await app.prisma.revenueEvent.create({
        data: {
          contactId: event.contactId,
          organizationId: orgId,
          amount: event.amount,
          currency: event.currency,
          source: event.source ?? "api",
          reference: event.reference ?? null,
          recordedBy: event.recordedBy,
          timestamp: eventTimestamp,
        },
      });

      // Emit to ConversionBus (best-effort)
      if (app.conversionBus) {
        app.conversionBus.emit({
          type: "purchased",
          contactId: event.contactId,
          organizationId: orgId,
          value: event.amount,
          sourceAdId: contact.sourceAdId ?? undefined,
          sourceCampaignId: contact.sourceCampaignId ?? undefined,
          timestamp: eventTimestamp,
          metadata: {
            source: event.source ?? "api",
            reference: event.reference,
            recordedBy: event.recordedBy,
            currency: event.currency,
            inboundWebhook: true,
          },
        });
      }

      logger.info(
        { contactId: event.contactId, amount: event.amount, orgId },
        "Revenue event received via inbound webhook",
      );

      return reply.code(201).send({ recorded: true, contactId: event.contactId });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/inbound/forms/verify — Facebook webhook verification challenge
  // ─────────────────────────────────────────────────────────────────────────
  app.get(
    "/forms/verify",
    {
      schema: {
        description: "Handle Facebook webhook verification challenge.",
        tags: ["Inbound Webhooks"],
        querystring: {
          type: "object",
          properties: {
            "hub.mode": { type: "string" },
            "hub.verify_token": { type: "string" },
            "hub.challenge": { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const query = request.query as {
        "hub.mode"?: string;
        "hub.verify_token"?: string;
        "hub.challenge"?: string;
      };

      const verifyToken = process.env["FACEBOOK_VERIFY_TOKEN"];

      const tokenMatches =
        verifyToken &&
        query["hub.verify_token"] &&
        query["hub.verify_token"].length === verifyToken.length &&
        timingSafeEqual(Buffer.from(query["hub.verify_token"]), Buffer.from(verifyToken));

      if (query["hub.mode"] === "subscribe" && tokenMatches && query["hub.challenge"]) {
        return reply.code(200).send(query["hub.challenge"]);
      }

      return reply.code(403).send({ error: "Verification failed" });
    },
  );
};

// ── Stripe Event Handlers ──

async function handleStripeEvent(
  app: import("fastify").FastifyInstance,
  event: { id: string; type: string; data: { object: Record<string, unknown> }; created: number },
): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case "payment_intent.succeeded": {
      logger.info({ paymentIntentId: obj["id"], amount: obj["amount"] }, "Payment succeeded");
      try {
        await executeGovernedSystemAction({
          orchestrator: app.orchestrator,
          actionType: "payment.log",
          cartridgeId: "customer-engagement",
          organizationId: String(
            (obj["metadata"] as Record<string, unknown> | undefined)?.["organizationId"] ??
              "system",
          ),
          parameters: {
            paymentId: obj["id"],
            amount: obj["amount"],
            currency: obj["currency"],
            customerId: obj["customer"],
            status: "succeeded",
          },
          idempotencyKey: `stripe:${event.id}`,
        });
      } catch (err) {
        logger.warn({ err, paymentId: obj["id"] }, "Failed to log payment via governance");
      }
      break;
    }

    case "invoice.paid": {
      logger.info({ invoiceId: obj["id"], customerId: obj["customer"] }, "Invoice paid");
      break;
    }

    case "invoice.payment_failed": {
      logger.info({ invoiceId: obj["id"], customerId: obj["customer"] }, "Invoice payment failed");
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      logger.info(
        { subscriptionId: obj["id"], status: obj["status"], eventType: event.type },
        "Subscription event",
      );
      break;
    }

    case "charge.dispute.created": {
      logger.info({ disputeId: obj["id"], chargeId: obj["charge"] }, "Dispute created");
      break;
    }

    default: {
      logger.info({ eventType: event.type, eventId: event.id }, "Unhandled Stripe event type");
    }
  }
}

// ── Form Submission Handler ──

async function handleFormSubmission(
  app: import("fastify").FastifyInstance,
  leadId: string,
  submission: {
    source: string;
    formId?: string;
    submittedAt?: string;
    fields: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      serviceInterest?: string;
      message?: string;
    };
  },
): Promise<void> {
  // Step 1: Create CRM contact via governance
  try {
    await executeGovernedSystemAction({
      orchestrator: app.orchestrator,
      actionType: "crm.contact.create",
      cartridgeId: "crm",
      organizationId: "system",
      parameters: {
        email: submission.fields.email ?? `lead-${leadId}@unknown.com`,
        firstName: submission.fields.firstName,
        lastName: submission.fields.lastName,
        phone: submission.fields.phone,
        channel: submission.source,
        properties: {
          leadId,
          source: submission.source,
          formId: submission.formId,
          serviceInterest: submission.fields.serviceInterest,
          submittedAt: submission.submittedAt ?? new Date().toISOString(),
        },
      },
      idempotencyKey: `form:contact:${leadId}`,
    });
  } catch (err) {
    logger.warn({ err, leadId }, "Failed to create CRM contact via governance");
  }

  // Step 2: Trigger customer engagement qualification via governance
  try {
    await executeGovernedSystemAction({
      orchestrator: app.orchestrator,
      actionType: "lead.qualify",
      cartridgeId: "customer-engagement",
      organizationId: "system",
      parameters: {
        leadId,
        source: submission.source,
        firstName: submission.fields.firstName,
        phone: submission.fields.phone,
        serviceInterest: submission.fields.serviceInterest,
      },
      idempotencyKey: `form:qualify:${leadId}`,
    });
  } catch (err) {
    logger.warn({ err, leadId }, "Failed to qualify lead via governance");
  }

  logger.info({ leadId, source: submission.source }, "Form submission processed");
}

// ── Booking Confirmation Handler ──

async function handleBookingConfirmation(
  app: import("fastify").FastifyInstance,
  booking: {
    leadId?: string;
    contactExternalId?: string;
    bookingId: string;
    service?: string;
    provider?: string;
    scheduledAt?: string;
    source: string;
    organizationId?: string;
  },
): Promise<void> {
  const orgId = booking.organizationId;

  // Step 1: Update CRM deal stage to booked via governance
  if (booking.leadId || booking.contactExternalId) {
    try {
      await executeGovernedSystemAction({
        orchestrator: app.orchestrator,
        actionType: "crm.deal.create",
        cartridgeId: "crm",
        organizationId: orgId ?? "system",
        parameters: {
          name: `Booking: ${booking.service ?? "Appointment"}`,
          stage: "booked",
          pipeline: "lead-conversion",
          contactExternalId: booking.contactExternalId,
          properties: {
            bookingId: booking.bookingId,
            service: booking.service,
            provider: booking.provider,
            scheduledAt: booking.scheduledAt,
            source: booking.source,
            leadId: booking.leadId,
          },
        },
        idempotencyKey: `booking:deal:${booking.bookingId}`,
      });
    } catch (err) {
      logger.warn({ err, bookingId: booking.bookingId }, "Failed to create CRM deal for booking");
    }
  }

  // Step 2: Emit booking conversion event for ad attribution feedback loop
  const conversionBus = app.conversionBus;

  if (conversionBus && orgId) {
    conversionBus.emit({
      type: "booked",
      contactId: booking.contactExternalId ?? booking.leadId ?? booking.bookingId,
      organizationId: orgId,
      value: 1,
      timestamp: new Date(),
      metadata: {
        bookingId: booking.bookingId,
        service: booking.service,
        source: booking.source,
        scheduledAt: booking.scheduledAt,
      },
    });
    logger.info({ bookingId: booking.bookingId, orgId }, "Booking conversion event emitted");
  }

  logger.info(
    { bookingId: booking.bookingId, source: booking.source, service: booking.service },
    "Booking confirmation processed",
  );
}

// ── Stripe Signature Verification ──

function verifyStripeSignature(payload: string, signatureHeader: string, secret: string): boolean {
  try {
    const parts = signatureHeader.split(",");
    const timestampPart = parts.find((p) => p.startsWith("t="));
    const sigPart = parts.find((p) => p.startsWith("v1="));

    if (!timestampPart || !sigPart) return false;

    const timestamp = timestampPart.slice(2);
    const signature = sigPart.slice(3);

    // Check timestamp is not too old (5 minute tolerance)
    const ts = parseInt(timestamp, 10);
    if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const expectedSig = createHmac("sha256", secret).update(signedPayload).digest("hex");

    // Timing-safe comparison
    if (signature.length !== expectedSig.length) return false;
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i]! ^ b[i]!;
    }
    return result === 0;
  } catch {
    return false;
  }
}
