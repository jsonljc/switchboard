import type { FastifyPluginAsync } from "fastify";
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
  app.post("/leads/webhook", async (request, reply) => {
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
      return reply.code(200).send({ received: leads.length, created: 0 });
    }

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
      targetHint: { skillSlug: "meta-lead" },
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
