import type { FastifyPluginAsync } from "fastify";
import { parseLeadWebhook } from "@switchboard/core/ad-optimizer";
import type { ConversionEvent } from "@switchboard/core";

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

    let created = 0;
    for (const lead of leads) {
      app.log.info(
        { leadId: lead.leadId, adId: lead.adId, email: lead.email ? "[redacted]" : undefined },
        "Received Meta lead",
      );

      if (!lead.phone || !organizationId) continue;

      if (app.prisma) {
        const { PrismaContactStore } = await import("@switchboard/db");
        const contactStore = new PrismaContactStore(app.prisma);

        // Dedup: skip if contact exists with same phone + adId
        const existing = await contactStore.findByPhone(organizationId, lead.phone);
        if (existing) {
          const existingAdId = (existing.attribution as Record<string, unknown> | null)?.sourceAdId;
          if (existingAdId === lead.adId) {
            app.log.info({ phone: "[redacted]", adId: lead.adId }, "Duplicate lead, skipping");
            continue;
          }
        }

        // Create contact with attribution
        await contactStore.create({
          organizationId,
          name: lead.name ?? null,
          phone: lead.phone,
          email: lead.email ?? null,
          primaryChannel: "whatsapp",
          source: "meta-instant-form",
          attribution: {
            sourceAdId: lead.adId,
            fbclid: null,
            gclid: null,
            ttclid: null,
            sourceCampaignId: null,
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
          },
        });
        created++;

        // Send WhatsApp template greeting
        try {
          const waToken = process.env["WHATSAPP_ACCESS_TOKEN"];
          const waPhoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
          if (waToken && waPhoneId) {
            const firstName = lead.name?.split(" ")[0] ?? "there";
            await sendWhatsAppTemplate(
              waToken,
              waPhoneId,
              lead.phone,
              greetingTemplateName,
              firstName,
            );
            app.log.info({ phone: "[redacted]" }, "Sent lead greeting template");
          }
        } catch (err) {
          app.log.error({ err, phone: "[redacted]" }, "Failed to send lead greeting template");
        }

        // Emit inquiry event for CAPI Lead event
        if (app.conversionBus) {
          const conversionEvent: ConversionEvent = {
            eventId: `evt_lead_${lead.leadId}`,
            type: "inquiry",
            contactId: lead.leadId,
            organizationId,
            value: 0,
            sourceAdId: lead.adId,
            occurredAt: new Date(),
            source: "meta-webhook",
            metadata: {},
          };
          app.conversionBus.emit(conversionEvent);
        }
      }
    }

    return reply.code(200).send({ received: leads.length, created });
  });
};

async function sendWhatsAppTemplate(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  firstName: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: firstName }],
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp template send failed: ${res.status} ${body}`);
  }
}
