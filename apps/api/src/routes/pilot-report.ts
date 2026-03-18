import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";

export interface PilotReportData {
  period: { startDate: string; endDate: string; days: number };

  speedToLead: {
    medianMs: number | null;
    percentWithin2Min: number | null;
    sampleSize: number;
    baseline: string | null;
  };

  conversion: {
    leads: number;
    payingPatients: number;
    ratePercent: number | null;
    baselinePercent: number | null;
  };

  costPerPatient: {
    amount: number | null;
    currency: string;
    adSpend: number | null;
    totalRevenue: number | null;
    roas: number | null;
    baselineAmount: number | null;
  };

  funnel: {
    leads: number;
    qualified: number;
    booked: number;
    showedUp: number;
    paid: number;
  };

  campaigns: Array<{
    name: string;
    spend: number | null;
    leads: number;
    payingPatients: number;
    revenue: number;
    costPerPatient: number | null;
  }>;
}

export const pilotReportRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/reports/pilot — pilot ROI report aggregation
  app.get("/pilot", async (request, reply) => {
    const prisma = app.prisma;
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    // Placeholder structure — real implementation queries Prisma for:
    // 1. CRM contacts created in period (leads) with journey stage counts
    // 2. Revenue events in period (paying patients) with amounts
    // 3. Ad spend from operator summary
    // 4. Speed-to-lead from conversation states
    // 5. Campaign attribution with revenue events joined
    // 6. Baseline from BusinessConfig.pilotBaseline
    return reply.send({ report: null, message: "Pilot report endpoint ready" });
  });
};
