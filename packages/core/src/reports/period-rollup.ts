import type { ReportInsightsProvider } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type {
  ReportStores,
  ReportCacheStore,
  BaselineStore,
  PullQuoteGenerator,
} from "./interfaces.js";
import type { PeriodRollup } from "./interfaces.js";
import { formatDateFolio } from "./period-helpers.js";
import { computeAttribution } from "./attribution-rule.js";
import { computeFunnel } from "./funnel-rollup.js";
import { computeCostVsValue } from "./cost-vs-value-rule.js";
import { computeCampaignRollup } from "./campaign-rollup.js";
import { computeManagedComparison } from "./managed-comparison-rollup.js";
import { computeHeldRate } from "./compute-held-rate.js";
import { computeConsentCompleteness } from "./compute-consent-completeness.js";
import { computeReceiptedBookings } from "./compute-receipted-bookings.js";
import { computeReceiptedBookingQuality } from "./compute-receipted-booking-quality.js";
import { computeReceiptedBookingRevenue } from "./compute-receipted-booking-revenue.js";

export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  baselineStore: BaselineStore;
  planMonthlyUSD: number;
  pullQuoteGenerator: PullQuoteGenerator;
}

export function createPeriodRollup(deps: ReportDependencies): PeriodRollup {
  return async ({ orgId, current, prior, computedAt }) => {
    if (!current.window) {
      throw new Error("current report window is required");
    }

    const ctx: RollupContext = { orgId, current, prior, computedAt };

    const [
      attribution,
      funnelResult,
      costResult,
      campaigns,
      managedComparison,
      heldRate,
      consentCompleteness,
      receiptedBookings,
      receiptedBookingQuality,
      receiptedBookingRevenue,
    ] = await Promise.all([
      computeAttribution(ctx, deps.stores),
      computeFunnel(ctx, deps.stores, deps.insightsProvider),
      computeCostVsValue(ctx, deps.planMonthlyUSD),
      computeCampaignRollup(ctx, deps.insightsProvider, deps.stores.revenue),
      computeManagedComparison(ctx, deps.insightsProvider, deps.baselineStore, deps.stores),
      computeHeldRate(ctx, deps.stores.bookings),
      computeConsentCompleteness(ctx, deps.stores.contacts),
      computeReceiptedBookings(ctx, deps.stores.receipts),
      computeReceiptedBookingQuality(ctx, deps.stores.receiptedBookings),
      computeReceiptedBookingRevenue(ctx, deps.stores.receiptedBookings),
    ]);

    const pullquote = await deps.pullQuoteGenerator({
      ctx,
      attribution,
      cost: costResult.cost,
      funnelNarrative: funnelResult.funnelNarrative,
    });

    return {
      label: current.window,
      period: formatDateFolio(current),
      dateFolio: formatDateFolio(current),
      pullquote,
      attribution,
      funnel: funnelResult.funnel,
      funnelNarrative: funnelResult.funnelNarrative,
      campaigns,
      cost: costResult.cost,
      costNarrative: costResult.costNarrative,
      managedComparison,
      heldRate,
      consentCompleteness,
      receiptedBookings,
      receiptedBookingQuality,
      receiptedBookingRevenue,
    };
  };
}
