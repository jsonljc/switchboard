// ---------------------------------------------------------------------------
// Inbound Webhook Receivers — Stripe events + lead capture forms
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { createHmac } from "node:crypto";
import { createLogger } from "../logger.js";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";

const logger = createLogger("inbound-webhooks");

/** Default system context for webhook-triggered actions */
function systemContext(orgId?: string): CartridgeContext {
  return {
    principalId: "system:webhook",
    organizationId: orgId ?? null,
    connectionCredentials: {},
  };
}

export const inboundWebhooksRoutes: FastifyPluginAsync = async (app) => {
  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/inbound/stripe — Receive Stripe webhook events
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/stripe", {
    schema: {
      description: "Receive and process Stripe webhook events with signature verification.",
      tags: ["Inbound Webhooks"],
    },
    config: {
      // Need raw body for signature verification
      rawBody: true,
    },
  }, async (request, reply) => {
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
    const rawBody = typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);

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
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/inbound/forms — Receive lead capture form submissions
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/forms", {
    schema: {
      description: "Receive lead capture form submissions from Facebook Lead Ads, Typeform, or custom forms.",
      tags: ["Inbound Webhooks"],
      body: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["facebook", "typeform", "custom", "instagram", "google"] },
          formId: { type: "string" },
          submittedAt: { type: "string" },
          fields: {
            type: "object",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" },
              treatmentInterest: { type: "string" },
              message: { type: "string" },
            },
          },
        },
        required: ["source", "fields"],
      },
    },
  }, async (request, reply) => {
    const submission = request.body as {
      source: string;
      formId?: string;
      submittedAt?: string;
      fields: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        treatmentInterest?: string;
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
        const expectedSig = createHmac("sha256", fbAppSecret)
          .update(rawBody)
          .digest("hex");
        if (submission.signature !== `sha256=${expectedSig}`) {
          return reply.code(401).send({ error: "Invalid Facebook signature" });
        }
      }
    }

    const leadId = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      {
        leadId,
        source: submission.source,
        email: submission.fields.email,
        treatmentInterest: submission.fields.treatmentInterest,
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
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/inbound/forms/verify — Facebook webhook verification challenge
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/forms/verify", {
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
  }, async (request, reply) => {
    const query = request.query as {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };

    const verifyToken = process.env["FACEBOOK_VERIFY_TOKEN"];

    if (
      query["hub.mode"] === "subscribe" &&
      query["hub.verify_token"] === verifyToken &&
      query["hub.challenge"]
    ) {
      return reply.code(200).send(query["hub.challenge"]);
    }

    return reply.code(403).send({ error: "Verification failed" });
  });
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
      // Dispatch to orchestrator: log payment, update CRM deal stage
      const patientEngagement = app.storageContext.cartridges.get("patient-engagement");
      if (patientEngagement) {
        try {
          await patientEngagement.execute("payment.log", {
            paymentId: obj["id"],
            amount: obj["amount"],
            currency: obj["currency"],
            customerId: obj["customer"],
            status: "succeeded",
          }, systemContext());
        } catch {
          // Non-fatal — log and continue
        }
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
      treatmentInterest?: string;
      message?: string;
    };
  },
): Promise<void> {
  // Step 1: Create CRM contact
  const crmCartridge = app.storageContext.cartridges.get("crm");
  if (crmCartridge) {
    try {
      await crmCartridge.execute("crm.contact.create", {
        email: submission.fields.email ?? `lead-${leadId}@unknown.com`,
        firstName: submission.fields.firstName,
        lastName: submission.fields.lastName,
        phone: submission.fields.phone,
        channel: submission.source,
        properties: {
          leadId,
          source: submission.source,
          formId: submission.formId,
          treatmentInterest: submission.fields.treatmentInterest,
          submittedAt: submission.submittedAt ?? new Date().toISOString(),
        },
      }, systemContext());
    } catch {
      // Non-fatal
    }
  }

  // Step 2: Trigger patient engagement qualification
  const peCartridge = app.storageContext.cartridges.get("patient-engagement");
  if (peCartridge) {
    try {
      await peCartridge.execute("lead.qualify", {
        leadId,
        source: submission.source,
        firstName: submission.fields.firstName,
        phone: submission.fields.phone,
        treatmentInterest: submission.fields.treatmentInterest,
      }, systemContext());
    } catch {
      // Non-fatal
    }
  }

  logger.info({ leadId, source: submission.source }, "Form submission processed");
}

// ── Stripe Signature Verification ──

function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
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
    const expectedSig = createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

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
