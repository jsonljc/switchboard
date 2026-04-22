// ---------------------------------------------------------------------------
// Revenue routes — record and query revenue events
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaRevenueStore, PrismaOutboxStore } from "@switchboard/db";
import { z } from "zod";
import { requireOrganizationScope } from "../utils/require-org.js";

// ── Input Validation Schemas ──

const RecordRevenueInputSchema = z.object({
  contactId: z.string(),
  opportunityId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("SGD"),
  type: z.enum(["payment", "deposit", "invoice", "refund"]).default("payment"),
  recordedBy: z.enum(["owner", "staff", "stripe", "integration"]).default("owner"),
  externalReference: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

export const revenueRoutes: FastifyPluginAsync = async (app) => {
  // POST /:orgId/revenue — record a revenue event
  app.post("/:orgId/revenue", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { orgId: _paramOrgId } = request.params as { orgId: string };

    const parsed = RecordRevenueInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
    }

    const {
      contactId,
      opportunityId,
      amount,
      currency,
      type,
      recordedBy,
      externalReference,
      sourceCampaignId,
      sourceAdId,
    } = parsed.data;

    const resolvedOpportunityId = opportunityId ?? `rev-${contactId}-${Date.now()}`;

    const store = new PrismaRevenueStore(app.prisma);
    const event = await store.record({
      organizationId: orgId,
      contactId,
      opportunityId: resolvedOpportunityId,
      amount,
      currency,
      type,
      recordedBy,
      externalReference: externalReference ?? null,
      sourceCampaignId: sourceCampaignId ?? null,
      sourceAdId: sourceAdId ?? null,
    });

    // Write conversion event to outbox for durable processing
    if (app.prisma) {
      const outboxStore = new PrismaOutboxStore(app.prisma);
      await outboxStore.write(`evt_rev_${event.id}`, "purchased", {
        type: "purchased",
        contactId,
        organizationId: orgId,
        value: amount,
        sourceAdId: sourceAdId ?? null,
        sourceCampaignId: sourceCampaignId ?? null,
        occurredAt: new Date().toISOString(),
        source: "revenue-api",
        metadata: { opportunityId: resolvedOpportunityId, currency, revenueType: type },
      });
    }

    return reply.code(201).send({ event });
  });

  // GET /:orgId/revenue — list revenue events by opportunityId or sumByOrg
  app.get("/:orgId/revenue", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { opportunityId } = request.query as { opportunityId?: string };
    const store = new PrismaRevenueStore(app.prisma);

    if (opportunityId) {
      const events = await store.findByOpportunity(orgId, opportunityId);
      return reply.send({ events });
    }

    const summary = await store.sumByOrg(orgId);
    return reply.send({ summary });
  });

  // GET /:orgId/revenue/summary — total revenue by org
  app.get("/:orgId/revenue/summary", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaRevenueStore(app.prisma);
    const summary = await store.sumByOrg(orgId);
    return reply.send({ summary });
  });

  // GET /:orgId/revenue/by-campaign — revenue grouped by campaign
  app.get("/:orgId/revenue/by-campaign", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaRevenueStore(app.prisma);
    const campaigns = await store.sumByCampaign(orgId);
    return reply.send({ campaigns });
  });
};
