import type { FastifyPluginAsync } from "fastify";
import { parseLeadWebhook } from "@switchboard/core/ad-optimizer";

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

  // Meta Leads webhook receiver (POST)
  app.post("/leads/webhook", async (request, reply) => {
    const leads = parseLeadWebhook(request.body);

    if (leads.length === 0) {
      return reply.code(200).send({ received: 0 });
    }

    // TODO (SP3): Create Contact records with attribution data
    for (const lead of leads) {
      app.log.info(
        { leadId: lead.leadId, adId: lead.adId, email: lead.email ? "[redacted]" : undefined },
        "Received Meta lead",
      );
    }

    return reply.code(200).send({ received: leads.length });
  });
};
