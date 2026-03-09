// ---------------------------------------------------------------------------
// Inbound Message Routes — Twilio SMS webhook + web chat endpoint
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { createHmac } from "node:crypto";
import { createLogger } from "../logger.js";
import type { CartridgeContext } from "@switchboard/cartridge-sdk";

const logger = createLogger("inbound-messages");

/** Default system context for message-triggered actions */
function systemContext(orgId?: string): CartridgeContext {
  return {
    principalId: "system:inbound-message",
    organizationId: orgId ?? null,
    connectionCredentials: {},
  };
}

export const inboundMessagesRoutes: FastifyPluginAsync = async (app) => {
  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/messages/sms — Twilio inbound SMS webhook
  //
  // Twilio sends form-encoded POST requests when an SMS is received.
  // This endpoint verifies the signature, routes the message to the
  // conversation engine, and returns a TwiML response.
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/sms",
    {
      schema: {
        description: "Receive inbound SMS messages from Twilio webhook.",
        tags: ["Inbound Messages"],
      },
    },
    async (request, reply) => {
      // Twilio sends form-encoded data
      const body = request.body as Record<string, string>;
      const from = body["From"] ?? "";
      const to = body["To"] ?? "";
      const messageBody = body["Body"] ?? "";
      const messageSid = body["MessageSid"] ?? "";

      // Verify Twilio signature if auth token is configured
      const twilioAuthToken = process.env["TWILIO_AUTH_TOKEN"];
      if (twilioAuthToken) {
        const twilioSignature = request.headers["x-twilio-signature"] as string | undefined;
        const requestUrl = buildTwilioRequestUrl(request);

        if (
          !twilioSignature ||
          !verifyTwilioSignature(twilioAuthToken, twilioSignature, requestUrl, body)
        ) {
          logger.warn({ from, messageSid }, "Invalid Twilio webhook signature");
          return reply.code(401).send({ error: "Invalid signature" });
        }
      }

      logger.info({ from, to, messageSid, bodyLength: messageBody.length }, "Received inbound SMS");

      const orgId = request.organizationIdFromAuth ?? resolveOrgFromNumber(to);

      // Route message to conversation engine
      let responseMessages: string[] = [];
      try {
        const router = await getConversationRouter(app, orgId);
        if (router) {
          const result = await router.handleMessage({
            channelId: from,
            channelType: "sms",
            body: messageBody,
            from,
            timestamp: new Date(),
            organizationId: orgId,
            metadata: { messageSid, to },
          });

          responseMessages = result.responses;

          // If an action is required, dispatch it through the orchestrator
          if (result.actionRequired) {
            const peCartridge = app.storageContext.cartridges.get("customer-engagement");
            if (peCartridge) {
              try {
                await peCartridge.execute(
                  result.actionRequired.actionType,
                  result.actionRequired.parameters,
                  systemContext(orgId),
                );
              } catch (err) {
                logger.error(
                  { err, actionType: result.actionRequired.actionType },
                  "Failed to dispatch conversation action",
                );
              }
            }
          }

          if (result.escalated) {
            logger.info(
              { from, sessionId: result.sessionId },
              "Conversation escalated to human agent",
            );
          }
        }
      } catch (err) {
        logger.error({ err, from, messageSid }, "Error routing inbound SMS");
        responseMessages = [
          "Sorry, we're experiencing technical difficulties. Please try again later.",
        ];
      }

      // Return TwiML response
      const twiml = buildTwiMLResponse(responseMessages);
      return reply.code(200).header("Content-Type", "text/xml").send(twiml);
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/messages/chat — Web chat inbound messages
  //
  // For web chat widgets embedded on the clinic's website.
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/chat",
    {
      schema: {
        description: "Receive inbound messages from web chat widget.",
        tags: ["Inbound Messages"],
        body: {
          type: "object",
          required: ["channelId", "body"],
          properties: {
            channelId: { type: "string", description: "Unique chat session identifier" },
            body: { type: "string", description: "Message text" },
            from: { type: "string", description: "Sender identifier (name or email)" },
            metadata: { type: "object", description: "Additional metadata" },
          },
        },
      },
    },
    async (request, reply) => {
      const {
        channelId,
        body: messageBody,
        from,
        metadata,
      } = request.body as {
        channelId: string;
        body: string;
        from?: string;
        metadata?: Record<string, unknown>;
      };

      const orgIdFromMetadata =
        typeof metadata?.["organizationId"] === "string" ? metadata["organizationId"] : null;
      const orgId = request.organizationIdFromAuth ?? orgIdFromMetadata;
      if (!orgId) {
        return reply.code(400).send({
          error: "organizationId is required for web chat requests",
          hint: "Pass metadata.organizationId from the embedded chat widget.",
        });
      }

      logger.info(
        { channelId, from, orgId, bodyLength: messageBody.length },
        "Received web chat message",
      );

      try {
        const router = await getConversationRouter(app, orgId);
        if (!router) {
          return reply.code(503).send({ error: "Conversation service unavailable" });
        }

        const result = await router.handleMessage({
          channelId,
          channelType: "web_chat",
          body: messageBody,
          from: from ?? channelId,
          timestamp: new Date(),
          organizationId: orgId,
          metadata,
        });

        // Dispatch any required actions
        if (result.actionRequired) {
          const peCartridge = app.storageContext.cartridges.get("customer-engagement");
          if (peCartridge) {
            try {
              await peCartridge.execute(
                result.actionRequired.actionType,
                result.actionRequired.parameters,
                systemContext(orgId),
              );
            } catch (err) {
              logger.error(
                { err, actionType: result.actionRequired.actionType },
                "Failed to dispatch chat action",
              );
            }
          }
        }

        return reply.code(200).send({
          responses: result.responses,
          sessionId: result.sessionId,
          escalated: result.escalated,
          completed: result.completed,
        });
      } catch (err) {
        logger.error({ err, channelId }, "Error processing web chat message");
        return reply.code(200).send({
          responses: ["Sorry, we're experiencing technical difficulties. Please try again later."],
          sessionId: null,
          escalated: false,
          completed: false,
        });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/messages/status — Twilio message status callback
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/status",
    {
      schema: {
        description: "Receive Twilio message delivery status updates.",
        tags: ["Inbound Messages"],
      },
    },
    async (request, reply) => {
      const body = request.body as Record<string, string>;
      const messageSid = body["MessageSid"] ?? "";
      const messageStatus = body["MessageStatus"] ?? "";
      const errorCode = body["ErrorCode"];

      logger.info({ messageSid, messageStatus, errorCode }, "Message status update");

      // Track delivery failures for conversation state
      if (messageStatus === "failed" || messageStatus === "undelivered") {
        logger.warn({ messageSid, messageStatus, errorCode }, "Message delivery failed");
      }

      return reply.code(200).send({ received: true });
    },
  );
};

// ── Helpers ──

/** Conversation router type (imported dynamically) */
type ConvRouter = {
  handleMessage(msg: {
    channelId: string;
    channelType: "sms" | "web_chat" | "instagram_dm" | "facebook_messenger" | "whatsapp";
    body: string;
    from: string;
    timestamp: Date;
    organizationId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    handled: boolean;
    responses: string[];
    actionRequired?: { actionType: string; parameters: Record<string, unknown> };
    escalated: boolean;
    completed: boolean;
    sessionId: string | null;
  }>;
};

/**
 * Get or create a conversation router for an organization.
 * Lazy-loads conversation flow templates from @switchboard/customer-engagement.
 */
async function getConversationRouter(
  app: import("fastify").FastifyInstance,
  _orgId: string,
): Promise<ConvRouter | null> {
  try {
    const pe = await import("@switchboard/customer-engagement");

    // Load flow templates from the DEFAULT_CADENCE_TEMPLATES won't work here,
    // but the conversation templates are exported from the main package.
    // Use createConversationState + executeNextStep to build a simple router.
    const { ConversationRouter, InMemorySessionStore, RedisSessionStore } = pe;

    // Build flows map from available templates
    const flows = new Map<
      string,
      import("@switchboard/customer-engagement").ConversationFlowDefinition
    >();

    // The package exports conversation flow definitions
    // We'll create a default qualification flow inline if none exist
    if (flows.size === 0) {
      flows.set("qualification", {
        id: "qualification",
        name: "Lead Qualification",
        description: "Qualify incoming leads through a conversational flow",
        variables: ["patientName", "patientPhone", "treatmentInterest"],
        steps: [
          {
            id: "greeting",
            type: "message" as const,
            template:
              "Hi! Thanks for reaching out. I'd love to help you. What treatment are you interested in?",
          },
          {
            id: "treatment_interest",
            type: "question" as const,
            template: "What brings you in today?",
            options: ["Botox/Fillers", "Laser Treatment", "Dental Care", "Consultation", "Other"],
          },
          {
            id: "schedule_prompt",
            type: "message" as const,
            template:
              "Great choice! Let me check our availability for you. Would you like to schedule a consultation?",
          },
          {
            id: "book_action",
            type: "action" as const,
            actionType: "appointment.check_availability",
            actionParameters: { treatmentInterest: "{{treatmentInterest}}" },
            template: "Let me look up available times for you...",
          },
          {
            id: "closing",
            type: "message" as const,
            template:
              "Thank you, {{patientName}}! We'll get you booked right away. You'll receive a confirmation shortly.",
          },
        ],
      });
    }

    // Use Redis session store if available, otherwise in-memory
    let sessionStore: import("@switchboard/customer-engagement").ConversationSessionStore;
    if (app.redis) {
      sessionStore = new RedisSessionStore(app.redis);
    } else {
      sessionStore = new InMemorySessionStore();
    }

    const defaultFlowId = flows.keys().next().value!;

    return new ConversationRouter({
      sessionStore,
      flows,
      defaultFlowId,
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    });
  } catch (err) {
    logger.error({ err }, "Failed to create conversation router");
    return null;
  }
}

/**
 * Resolve organization ID from the Twilio phone number being texted.
 */
function resolveOrgFromNumber(_phoneNumber: string): string {
  // In production, this would look up the org by their assigned Twilio number
  return "default";
}

/**
 * Build the full request URL for Twilio signature verification.
 */
function buildTwilioRequestUrl(request: import("fastify").FastifyRequest): string {
  const protocol = request.headers["x-forwarded-proto"] ?? "https";
  const host = request.headers["host"] ?? "localhost";
  return `${protocol}://${host}${request.url}`;
}

/**
 * Verify Twilio webhook signature.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  try {
    // Sort params alphabetically and concatenate to URL
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    const expectedSig = createHmac("sha1", authToken).update(data).digest("base64");

    // Timing-safe comparison
    if (signature.length !== expectedSig.length) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSig);
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

/**
 * Build a TwiML XML response for Twilio.
 */
function buildTwiMLResponse(messages: string[]): string {
  if (messages.length === 0) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  const messageElements = messages.map((msg) => `<Message>${escapeXml(msg)}</Message>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messageElements}</Response>`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
