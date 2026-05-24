// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";
import {
  createPeriodRollup,
  createPullQuoteGenerator,
  createAnthropicReportLLMClient,
  windowToRange,
  priorPeriodRange,
  createInMemoryBaselineStore,
  type LLMClient,
  type ReportDependencies,
  type ReportStores,
  type ReportCacheStore,
  type BaselineStore,
} from "@switchboard/core/reports";
import type { ReportInsightsProvider, ReportWindow } from "@switchboard/schemas";
import { MetaReportInsightsProvider, MetaAdsClient } from "@switchboard/ad-optimizer";
import { decryptCredentials } from "@switchboard/db";

const VALID_WINDOWS = new Set<string>(["THIS WEEK", "THIS MONTH", "THIS QUARTER"]);
const CACHE_TTL_MS = 60 * 60 * 1000;

const PLAN_MONTHLY_USD: Record<string, number> = {
  Starter: 299,
  Pro: 499,
  Scale: 799,
};

async function resolveInsightsProvider(
  app: { prisma: import("@switchboard/db").PrismaClient | null },
  orgId: string,
): Promise<ReportInsightsProvider | null> {
  if (!app.prisma) return null;
  const conn = await app.prisma.connection.findFirst({
    where: { organizationId: orgId, serviceId: "meta", status: "connected" },
    select: { externalAccountId: true, credentials: true },
  });
  if (!conn?.externalAccountId || !conn.credentials) return null;
  try {
    const credentialsStr =
      typeof conn.credentials === "string" ? conn.credentials : JSON.stringify(conn.credentials);
    const creds = decryptCredentials(credentialsStr);
    const adsClient = new MetaAdsClient({
      accountId: conn.externalAccountId,
      accessToken: String(creds.accessToken ?? ""),
    });
    return new MetaReportInsightsProvider(adsClient);
  } catch {
    // Invalid/expired credentials — fall back to null provider
    return null;
  }
}

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
  baselineStore: BaselineStore,
) {
  const now = new Date();
  const current = windowToRange(window, now);
  const prior = priorPeriodRange(current);

  const stripePriceId = await stores.orgConfig.getStripePriceId(orgId);
  const planMonthlyUSD = resolvePlanMonthlyUSD(stripePriceId);

  const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
  const llmClient: LLMClient | null = anthropicApiKey
    ? createAnthropicReportLLMClient(anthropicApiKey)
    : null;
  const pullQuoteGenerator = createPullQuoteGenerator({ llm: llmClient });

  const deps: ReportDependencies = {
    stores,
    insightsProvider,
    reportCache: reportCacheStore,
    baselineStore,
    planMonthlyUSD,
    pullQuoteGenerator,
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
  // Dev/test mode (authDisabled): allow `x-org-id` header to set the org scope so
  // the same handler can serve multi-tenant tests without an auth middleware.
  // In production (authDisabled === false) the auth middleware sets organizationIdFromAuth
  // from API_KEY_METADATA — this hook does not run in that path because authDisabled is false.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

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

    const insightsProvider = await resolveInsightsProvider(app, orgId);

    const baselineStore = app.baselineStore ?? createInMemoryBaselineStore();

    const payload = await computeReport(
      orgId,
      reportWindow,
      app.reportCacheStore,
      app.reportStores,
      insightsProvider,
      baselineStore,
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

    const insightsProvider = await resolveInsightsProvider(app, orgId);

    const baselineStore = app.baselineStore ?? createInMemoryBaselineStore();

    const payload = await computeReport(
      orgId,
      reportWindow,
      app.reportCacheStore,
      app.reportStores,
      insightsProvider,
      baselineStore,
    );

    return payload;
  });
};
