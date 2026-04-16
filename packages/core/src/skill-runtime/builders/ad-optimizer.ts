import type { BatchParameterBuilder, BatchContextContract } from "../batch-types.js";

const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "status",
  "impressions",
  "clicks",
  "spend",
  "conversions",
  "revenue",
  "frequency",
  "cpm",
  "ctr",
  "cpc",
];

export const AD_OPTIMIZER_CONTRACT: BatchContextContract = {
  required: [
    { key: "campaign_insights", source: "ads", scope: "current_period" },
    { key: "campaign_insights_previous", source: "ads", scope: "previous_period" },
    { key: "account_summary", source: "ads" },
    { key: "crm_funnel_data", source: "crm" },
    { key: "benchmarks", source: "benchmark" },
    { key: "deployment_config", source: "deployment", freshnessSeconds: 0 },
  ],
};

function getWeeklyDateRanges() {
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - 6);
  const prevUntil = new Date(since);
  prevUntil.setDate(prevUntil.getDate() - 1);
  const prevSince = new Date(prevUntil);
  prevSince.setDate(prevSince.getDate() - 6);
  const fmt = (d: Date) => d.toISOString().split("T")[0] ?? "";
  return {
    current: { since: fmt(since), until: fmt(until) },
    previous: { since: fmt(prevSince), until: fmt(prevUntil) },
  };
}

export const adOptimizerBuilder: BatchParameterBuilder = async (config, stores, _contract) => {
  const dateRanges = getWeeklyDateRanges();

  const [currentInsights, previousInsights, accountSummary, deployment] = await Promise.all([
    stores.adsClient.getCampaignInsights({ dateRange: dateRanges.current, fields: INSIGHT_FIELDS }),
    stores.adsClient.getCampaignInsights({
      dateRange: dateRanges.previous,
      fields: INSIGHT_FIELDS,
    }),
    stores.adsClient.getAccountSummary(),
    stores.deploymentStore.findById(config.deploymentId),
  ]);

  const dep = deployment as {
    inputConfig?: Record<string, unknown>;
    organizationId?: string;
  } | null;
  const campaignIds = (currentInsights as Array<{ campaignId: string }>).map((i) => i.campaignId);

  const [crmFunnel, benchmarks] = await Promise.all([
    stores.crmDataProvider.getFunnelData(campaignIds),
    stores.crmDataProvider.getBenchmarks(dep?.organizationId ?? config.orgId),
  ]);

  return {
    CAMPAIGN_INSIGHTS: currentInsights,
    PREVIOUS_INSIGHTS: previousInsights,
    ACCOUNT_SUMMARY: accountSummary,
    CRM_FUNNEL: crmFunnel,
    BENCHMARKS: benchmarks,
    DEPLOYMENT_CONFIG: dep?.inputConfig ?? {},
  };
};
