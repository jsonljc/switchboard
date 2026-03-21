import type { FastifyPluginAsync } from "fastify";
import { RevenueEventSchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const revenueRoutes: FastifyPluginAsync = async (app) => {
  async function getCrmProvider(organizationId: string) {
    if (!app.prisma) {
      throw new Error("Database not available");
    }
    const { PrismaCrmProvider } = await import("@switchboard/db");
    return new PrismaCrmProvider(app.prisma, organizationId);
  }

  // POST /api/revenue — Record a revenue event
  app.post(
    "/",
    {
      schema: {
        description: "Record a revenue event (payment) for a contact.",
        tags: ["Revenue"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const parseResult = RevenueEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.format() });
      }

      const event = parseResult.data;

      if (!app.prisma) {
        return reply.status(503).send({ error: "Database not available" });
      }

      const provider = await getCrmProvider(orgId);
      const contact = await provider.getContact(event.contactId);
      if (!contact) {
        return reply.status(404).send({ error: "Contact not found" });
      }

      const eventTimestamp = event.timestamp ? new Date(event.timestamp) : new Date();

      // Persist revenue event to database FIRST
      await app.prisma.revenueEvent.create({
        data: {
          contactId: event.contactId,
          organizationId: orgId,
          amount: event.amount,
          currency: event.currency,
          source: event.source,
          reference: event.reference ?? null,
          recordedBy: event.recordedBy,
          timestamp: eventTimestamp,
        },
      });

      // Emit to ConversionBus (best-effort — event is already persisted)
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
            source: event.source,
            reference: event.reference,
            recordedBy: event.recordedBy,
            currency: event.currency,
          },
        });
      }

      return reply.status(201).send({ recorded: true, contactId: event.contactId });
    },
  );
};
