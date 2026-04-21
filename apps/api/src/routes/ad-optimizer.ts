import type { FastifyPluginAsync } from "fastify";
import { parseLeadWebhook } from "@switchboard/ad-optimizer";
import { resolveDeploymentForIntent } from "../utils/resolve-deployment.js";

const VERIFY_TOKEN = process.env["META_WEBHOOK_VERIFY_TOKEN"] ?? "switchboard-verify";

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

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: "Verification failed" });
  });

  // Meta Leads webhook receiver (POST) — thin adapter into PlatformIngress
  app.post("/leads/webhook", async (request, reply) => {
    const leads = parseLeadWebhook(request.body);
    if (leads.length === 0) {
      return reply.code(200).send({ received: 0, created: 0 });
    }

    const payload = request.body as { entry?: Array<{ id?: string }> };
    const entryId = payload.entry?.[0]?.id;
    if (!entryId || !app.prisma) {
      return reply.code(200).send({ received: leads.length, created: 0 });
    }

    const connection = await app.prisma.connection.findFirst({
      where: { serviceId: "meta-ads", externalAccountId: entryId },
    });

    if (!connection?.organizationId) {
      return reply.code(200).send({ received: leads.length, created: 0 });
    }

    const greetingTemplateName =
      (connection as { greetingTemplateName?: string | null }).greetingTemplateName ??
      "lead_welcome";

    const deployment = await resolveDeploymentForIntent(
      app.deploymentResolver,
      connection.organizationId,
      "meta.lead.intake",
    );

    const response = await app.platformIngress.submit({
      organizationId: connection.organizationId,
      actor: { id: `meta:${entryId}`, type: "service" },
      intent: "meta.lead.intake",
      parameters: {
        payload: request.body as Record<string, unknown>,
        greetingTemplateName,
      },
      deployment,
      trigger: "internal",
      traceId: request.traceId,
    });

    if (!response.ok) {
      return reply.code(400).send({ error: response.error.message });
    }

    return reply.code(200).send(response.result.outputs);
  });
};
