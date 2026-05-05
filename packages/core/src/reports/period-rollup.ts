import type { PullQuoteCopy, CampaignRow, ReportInsightsProvider } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores, ReportCacheStore } from "./interfaces.js";
import type { PeriodRollup } from "./interfaces.js";
import { formatDateFolio } from "./period-helpers.js";
import { computeAttribution } from "./attribution-rule.js";
import { computeFunnel } from "./funnel-rollup.js";
import { computeCostVsValue } from "./cost-vs-value-rule.js";

export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  planMonthlyUSD: number;
}

const STUB_PULLQUOTE: PullQuoteCopy = {
  pre: "This period, your team generated",
  value: "—",
  mid: "in revenue, with Switchboard costing",
  cost: "—",
  post: "compared to a traditional stack.",
};

const STUB_CAMPAIGNS: CampaignRow[] = [];

export function createPeriodRollup(deps: ReportDependencies): PeriodRollup {
  return async ({ orgId, current, prior, computedAt }) => {
    if (!current.window) {
      throw new Error("current report window is required");
    }

    const ctx: RollupContext = { orgId, current, prior, computedAt };

    const [attribution, funnelResult, costResult] = await Promise.all([
      computeAttribution(ctx, deps.stores),
      computeFunnel(ctx, deps.stores, deps.insightsProvider),
      computeCostVsValue(ctx, deps.planMonthlyUSD),
    ]);

    return {
      label: current.window,
      period: formatDateFolio(current),
      dateFolio: formatDateFolio(current),
      pullquote: STUB_PULLQUOTE,
      attribution,
      funnel: funnelResult.funnel,
      funnelNarrative: funnelResult.funnelNarrative,
      campaigns: STUB_CAMPAIGNS,
      cost: costResult.cost,
      costNarrative: costResult.costNarrative,
      managedComparison: null,
    };
  };
}
