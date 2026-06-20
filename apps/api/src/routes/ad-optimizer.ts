// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseLeadWebhook } from "@switchboard/ad-optimizer";

function getVerifyToken(): string {
  const token = process.env["META_WEBHOOK_VERIFY_TOKEN"];
  if (!token) {
    throw new Error(
      "META_WEBHOOK_VERIFY_TOKEN is required. " +
        "Set this to the verify token configured in your Meta webhook settings.",
    );
  }
  return token;
}

/**
 * Verify Meta's `X-Hub-Signature-256` HMAC over the raw request body using
 * META_APP_SECRET. Fails closed: a missing secret, missing/empty raw body, or
 * missing/mismatched signature all return false. Mirrors the WhatsApp/Instagram
 * adapter verifyRequest implementations.
 */
export function verifyMetaWebhookSignature(
  rawBody: string | undefined,
  signature: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) {
    console.warn("[ad-optimizer] verifyMetaWebhookSignature called without META_APP_SECRET");
    return false;
  }
  if (!rawBody || typeof signature !== "string" || signature.length === 0) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const adOptimizerRoutes: FastifyPluginAsync = async (app) => {
  // Meta Leads webhook verification (GET)
  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/leads/webhook", async (request, reply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    let verifyToken: string;
    try {
      verifyToken = getVerifyToken();
    } catch {
      return reply
        .code(500)
        .send({ error: "Webhook verification not configured", statusCode: 500 });
    }

    if (mode === "subscribe" && token === verifyToken) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: "Verification failed", statusCode: 403 });
  });

  // Meta Leads webhook receiver (POST)
  app.post("/leads/webhook", { config: { rawBody: true } }, async (request, reply) => {
    // Verify the Meta HMAC signature before trusting any payload field. The org
    // is resolved from the webhook entry id below, which is forgeable without
    // this gate.
    const rawBody = (request as unknown as { rawBody?: string }).rawBody;
    const signatureHeader = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!verifyMetaWebhookSignature(rawBody, signature, process.env["META_APP_SECRET"])) {
      app.log.warn("Meta lead webhook: signature verification failed");
      return reply.code(401).send({ error: "Invalid signature", statusCode: 401 });
    }

    const leads = parseLeadWebhook(request.body);

    if (leads.length === 0) {
      return reply.code(200).send({ received: 0 });
    }

    // Resolve org from the webhook entry ID
    const payload = request.body as { entry?: Array<{ id?: string }> };
    const entryId = payload.entry?.[0]?.id;

    let organizationId: string | null = null;
    let greetingTemplateName = "lead_welcome";

    if (entryId && app.prisma) {
      const connection = await app.prisma.connection.findFirst({
        where: { serviceId: "meta-ads", externalAccountId: entryId },
      });
      if (connection?.organizationId) {
        organizationId = connection.organizationId;
        greetingTemplateName =
          (connection as { greetingTemplateName?: string | null }).greetingTemplateName ??
          "lead_welcome";
      }
    }

    if (!organizationId) {
      app.log.warn({ entryId }, "No org found for Meta webhook entry, skipping");
      return reply.code(200).send({ received: leads.length, skipped: true, reason: "no_org" });
    }

    const leadIds = leads.map((l) => l.leadId).sort();
    const idempotencyKey = `meta-lead-${entryId}-${leadIds.join(",")}`;

    const result = await app.platformIngress.submit({
      intent: "meta.lead.intake",
      parameters: {
        payload: request.body,
        greetingTemplateName,
      },
      actor: { id: "system", type: "service" },
      organizationId,
      trigger: "api",
      surface: { surface: "api" },
      // Resolve the org's real Alex deployment (the lead-conversion agent). "meta-lead" is not a
      // seeded deployment slug, so it threw deployment_not_found and shipped the inbound paid-lead
      // funnel prod-inert. meta.lead.intake threads its RESOLVED deploymentId into the lead it
      // ingests (meta-lead-intake-workflow.ts), so it must resolve a real deployment for correct
      // lead attribution — NOT platform-direct. The seeded allow policy then clears the gate.
      targetHint: { skillSlug: "alex" },
      idempotencyKey,
    });

    if (!result.ok) {
      app.log.error({ error: result.error }, "Lead intake submission failed");
      return reply.code(500).send({ error: result.error.message, statusCode: 500 });
    }

    return reply.code(200).send({
      received: leads.length,
      workUnitId: result.workUnit.id,
      traceId: result.workUnit.traceId,
    });
  });
};
