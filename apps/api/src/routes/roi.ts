// ---------------------------------------------------------------------------
// ROI routes — aggregate revenue loop analytics
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaConversionRecordStore, PrismaReconciliationStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export const roiRoutes: FastifyPluginAsync = async (app) => {
  // GET /:orgId/roi/summary — single aggregate ROI endpoint
  app.get("/:orgId/roi/summary", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { from, to, breakdown } = request.query as {
      from?: string;
      to?: string;
      breakdown?: string;
    };

    const now = new Date();
    const dateRange = {
      from: from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      to: to ? new Date(to) : now,
    };

    const dimension = breakdown ?? "campaign";

    const conversionStore = new PrismaConversionRecordStore(app.prisma);
    const reconStore = new PrismaReconciliationStore(app.prisma);

    const funnel = await conversionStore.funnelByOrg(orgId, dateRange);

    let breakdownData: unknown;
    switch (dimension) {
      case "channel":
        breakdownData = await conversionStore.funnelByChannel(orgId, dateRange);
        break;
      case "agent":
        breakdownData = await conversionStore.funnelByAgent(orgId, dateRange);
        break;
      default:
        breakdownData = await conversionStore.funnelByCampaign(orgId, dateRange);
    }

    const latestReport = await reconStore.latest(orgId);
    const health = latestReport
      ? {
          status: latestReport.overallStatus,
          lastRun: (latestReport as { createdAt: Date }).createdAt.toISOString(),
          checks: latestReport.checks,
        }
      : { status: "unknown", lastRun: null, checks: [] };

    return reply.send({ funnel, breakdown: breakdownData, health });
  });
};
