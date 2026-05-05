import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";
import {
  createPeriodRollup,
  windowToRange,
  priorPeriodRange,
  type ReportDependencies,
  type ReportStores,
  type ReportCacheStore,
} from "@switchboard/core/reports";
import type { ReportInsightsProvider, ReportWindow } from "@switchboard/schemas";

const VALID_WINDOWS = new Set<string>(["THIS WEEK", "THIS MONTH", "THIS QUARTER"]);
const CACHE_TTL_MS = 60 * 60 * 1000;

const PLAN_MONTHLY_USD: Record<string, number> = {
  Starter: 299,
  Pro: 499,
  Scale: 799,
};

function resolvePlanName(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const mapping: Record<string, string> = {};
  if (process.env["STRIPE_PRICE_STARTER"]) mapping[process.env["STRIPE_PRICE_STARTER"]] = "Starter";
  if (process.env["STRIPE_PRICE_PRO"]) mapping[process.env["STRIPE_PRICE_PRO"]] = "Pro";
  if (process.env["STRIPE_PRICE_SCALE"]) mapping[process.env["STRIPE_PRICE_SCALE"]] = "Scale";
  return mapping[priceId] ?? null;
}

function resolvePlanMonthlyUSD(stripePriceId: string | null): number {
  const planName = resolvePlanName(stripePriceId);
  return PLAN_MONTHLY_USD[planName ?? ""] ?? 0;
}

async function computeReport(
  orgId: string,
  window: ReportWindow,
  reportCacheStore: ReportCacheStore,
  stores: ReportStores,
  insightsProvider: ReportInsightsProvider | null,
) {
  const now = new Date();
  const current = windowToRange(window, now);
  const prior = priorPeriodRange(current);

  const stripePriceId = await stores.orgConfig.getStripePriceId(orgId);
  const planMonthlyUSD = resolvePlanMonthlyUSD(stripePriceId);

  const deps: ReportDependencies = {
    stores,
    insightsProvider,
    reportCache: reportCacheStore,
    planMonthlyUSD,
  };

  const rollup = createPeriodRollup(deps);
  const payload = await rollup({ orgId, current, prior, computedAt: now });

  await reportCacheStore.upsert({
    organizationId: orgId,
    window,
    payload,
    computedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
  });

  return payload;
}

export const dashboardReportsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/dashboard/reports", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { window } = request.query as { window?: string };
    if (!window || !VALID_WINDOWS.has(window)) {
      return reply
        .code(400)
        .send({ error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." });
    }
    const reportWindow = window as ReportWindow;

    if (!app.reportCacheStore || !app.reportStores) {
      return reply.code(503).send({ error: "Report dependencies not available" });
    }

    const cached = await app.reportCacheStore.findByKey(orgId, reportWindow);
    if (cached && cached.expiresAt > new Date()) {
      return cached.payload;
    }

    const payload = await computeReport(
      orgId,
      reportWindow,
      app.reportCacheStore,
      app.reportStores,
      app.reportInsightsProvider ?? null,
    );

    return payload;
  });

  app.post("/api/dashboard/reports/refresh", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { window } = request.query as { window?: string };
    if (!window || !VALID_WINDOWS.has(window)) {
      return reply
        .code(400)
        .send({ error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." });
    }
    const reportWindow = window as ReportWindow;

    if (!app.reportCacheStore || !app.reportStores) {
      return reply.code(503).send({ error: "Report dependencies not available" });
    }

    await app.reportCacheStore.invalidate(orgId, reportWindow);

    const payload = await computeReport(
      orgId,
      reportWindow,
      app.reportCacheStore,
      app.reportStores,
      app.reportInsightsProvider ?? null,
    );

    return payload;
  });
};
