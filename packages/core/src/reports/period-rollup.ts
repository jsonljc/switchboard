import type { PullQuoteCopy, ReportInsightsProvider } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores, ReportCacheStore, BaselineStore } from "./interfaces.js";
import type { PeriodRollup } from "./interfaces.js";
import { formatDateFolio } from "./period-helpers.js";
import { computeAttribution } from "./attribution-rule.js";
import { computeFunnel } from "./funnel-rollup.js";
import { computeCostVsValue } from "./cost-vs-value-rule.js";
import { computeCampaignRollup } from "./campaign-rollup.js";
import { computeManagedComparison } from "./managed-comparison-rollup.js";

export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  baselineStore: BaselineStore;
  planMonthlyUSD: number;
}

const STUB_PULLQUOTE: PullQuoteCopy = {
  pre: "This period, your team generated",
  value: "—",
  mid: "in revenue, with Switchboard costing",
  cost: "—",
  post: "compared to a traditional stack.",
};

export function createPeriodRollup(deps: ReportDependencies): PeriodRollup {
  return async ({ orgId, current, prior, computedAt }) => {
    if (!current.window) {
      throw new Error("current report window is required");
    }

    const ctx: RollupContext = { orgId, current, prior, computedAt };

    const [attribution, funnelResult, costResult, campaigns, managedComparison] = await Promise.all(
      [
        computeAttribution(ctx, deps.stores),
        computeFunnel(ctx, deps.stores, deps.insightsProvider),
        computeCostVsValue(ctx, deps.planMonthlyUSD),
        computeCampaignRollup(ctx, deps.insightsProvider, deps.stores.revenue),
        computeManagedComparison(ctx, deps.insightsProvider, deps.baselineStore, deps.stores),
      ],
    );

    return {
      label: current.window,
      period: formatDateFolio(current),
      dateFolio: formatDateFolio(current),
      pullquote: STUB_PULLQUOTE,
      attribution,
      funnel: funnelResult.funnel,
      funnelNarrative: funnelResult.funnelNarrative,
      campaigns,
      cost: costResult.cost,
      costNarrative: costResult.costNarrative,
      managedComparison,
    };
  };
}
