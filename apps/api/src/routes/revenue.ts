// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Revenue routes — record and query revenue events
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaRevenueStore } from "@switchboard/db";
import { z } from "zod";
import type { PaidVisitRow } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { RECORD_REVENUE_INTENT } from "../bootstrap/operator-intents.js";

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

/**
 * Convert a store row (raw amountCents) to a PaidVisitRow (amountMajor).
 * This is the ONLY place the ÷100 conversion happens — never in the store,
 * never in the dashboard. Hard unit boundary: 50000 cents → 500 major.
 */
export function toPaidVisitRow(row: {
  bookingId: string;
  amountCents: number;
  currency: string;
  sourceCampaignId: string | null;
  attributionBasis: "ctwa_captured" | "campaign_missing";
  paidAt: Date;
}): PaidVisitRow {
  return {
    bookingId: row.bookingId,
    amountMajor: row.amountCents / 100, // cents → major units EXACTLY ONCE
    currency: row.currency,
    campaignId: row.sourceCampaignId,
    campaignName: row.sourceCampaignId, // human label is the campaign id until a name-lookup ships
    attributionBasis: row.attributionBasis,
    paidAt: row.paidAt.toISOString(),
  };
}

export const revenueRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test mode (authDisabled): populate organizationIdFromAuth + principalIdFromAuth
  // from x-org-id / x-principal-id headers (or fall back to "default"). In production
  // this hook is a no-op; the real auth middleware has already populated the fields.
  app.addHook("preHandler", buildDevAuthFallback(app));

  // POST /:orgId/revenue — record a revenue event
  app.post("/:orgId/revenue", { preHandler: requireOrgForMutation }, async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
    }

    const idempotencyKey = requireIdempotencyKey(request, reply);
    if (!idempotencyKey) return;

    const parsed = RecordRevenueInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
    }

    const response = await app.platformIngress.submit({
      intent: RECORD_REVENUE_INTENT,
      parameters: parsed.data,
      actor: { id: request.actorId, type: "user" },
      organizationId: request.orgId, // auth is authoritative; :orgId path param is informational only
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey,
    });

    if (!response.ok) {
      return ingressErrorToReply(response.error, reply);
    }
    if (response.result.outcome === "failed") {
      // Revenue recording has no domain-failure path; any failed outcome is an
      // unexpected execution error. Throw so the global error handler returns a
      // scrubbed 500 (don't echo internal error codes/messages to the client).
      throw new Error(response.result.error?.message ?? "Revenue recording failed");
    }
    const event = response.result.outputs?.event;
    if (!event) {
      throw new Error("Revenue recording succeeded but returned no event");
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
  // With ?detail=paid-visits: returns per-visit rows (amountMajor = cents/100, done once here).
  // Default (no detail param): returns existing { campaigns } aggregate — unchanged.
  app.get("/:orgId/revenue/by-campaign", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaRevenueStore(app.prisma);
    const { detail } = request.query as { detail?: string };

    if (detail === "paid-visits") {
      const defaultTo = new Date();
      const defaultFrom = new Date(defaultTo.getTime() - 90 * 24 * 60 * 60 * 1000);
      const { from: fromQs, to: toQs } = request.query as { from?: string; to?: string };
      const parsedFrom = fromQs ? new Date(fromQs) : null;
      const parsedTo = toQs ? new Date(toQs) : null;
      const from = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : defaultFrom;
      const to = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : defaultTo;
      const visits = await store.paidVisitsByCampaign({
        orgId,
        from,
        to,
        isProduction: process.env["NODE_ENV"] === "production",
      });
      const paidVisits = visits.map(toPaidVisitRow);
      return reply.send({ paidVisits });
    }

    const campaigns = await store.sumByCampaign(orgId);
    return reply.send({ campaigns });
  });
};
