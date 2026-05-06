import type {
  ReportInsightsProvider,
  ManagedComparisonData,
  ManagedComparisonPair,
  Delta,
} from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { BaselineStore, ReportStores } from "./interfaces.js";
import { captureAdsBaseline } from "./baseline-capture.js";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeDelta(managed: number, unmanaged: number): Delta {
  if (unmanaged === 0) return { kind: "flat", text: "No baseline to compare" };
  const pct = ((managed - unmanaged) / unmanaged) * 100;
  if (Math.abs(pct) < 1) return { kind: "flat", text: "~0% change" };
  const sign = pct > 0 ? "+" : "";
  if (pct > 0) return { kind: "pos", text: `${sign}${pct.toFixed(0)}% vs baseline` };
  return { kind: "neg", text: `${pct.toFixed(0)}% vs baseline` };
}

async function buildAdsComparison(
  ctx: RollupContext,
  provider: ReportInsightsProvider,
  baselineStore: BaselineStore,
  revenueStore: Pick<ReportStores["revenue"], "sumByOrg">,
): Promise<ManagedComparisonPair | null> {
  const baselineRows = await baselineStore.listByDimension(ctx.orgId, "ads");
  if (baselineRows.length === 0) {
    captureAdsBaseline(ctx.orgId, provider, baselineStore).catch((error) => {
      console.warn("Failed to capture ads baseline", { orgId: ctx.orgId, error });
    });
    return null;
  }
  const dateRange = { since: formatDate(ctx.current.start), until: formatDate(ctx.current.end) };
  const currentMetrics = await provider.getAggregateMetrics(dateRange);
  const currentRevenue = await revenueStore.sumByOrg(ctx.orgId, {
    from: ctx.current.start,
    to: ctx.current.end,
  });
  const baselineSpend =
    baselineRows.filter((r) => r.metric === "spend").reduce((sum, r) => sum + r.value, 0) /
    Math.max(baselineRows.filter((r) => r.metric === "spend").length, 1);
  const managed = {
    spend: currentMetrics.spend,
    revenue: currentRevenue.totalAmount,
    roas: currentMetrics.spend > 0 ? currentRevenue.totalAmount / currentMetrics.spend : undefined,
  };
  const unmanaged = { spend: baselineSpend };
  const delta = computeDelta(managed.spend, unmanaged.spend);
  return { managed, unmanaged, delta };
}

async function buildConversationsComparison(
  ctx: RollupContext,
  stores: Pick<ReportStores, "conversations" | "deployment">,
): Promise<ManagedComparisonPair | null> {
  const alexSlug = await stores.deployment.getAlexSlug(ctx.orgId);
  if (!alexSlug) return null;
  const threadCounts = await stores.conversations.threadCountsByAgent({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
  });
  const alexCount = threadCounts.find((t) => t.assignedAgent === alexSlug)?.count ?? 0;
  if (alexCount === 0) return null;
  const operatorCount = threadCounts
    .filter((t) => t.assignedAgent !== alexSlug)
    .reduce((sum, t) => sum + t.count, 0);
  const managed = { spend: 0, replies: alexCount };
  const unmanaged = { spend: 0, replies: operatorCount };
  const delta = computeDelta(alexCount, operatorCount);
  return { managed, unmanaged, delta };
}

export async function computeManagedComparison(
  ctx: RollupContext,
  insightsProvider: ReportInsightsProvider | null,
  baselineStore: BaselineStore,
  stores: Pick<ReportStores, "conversations" | "deployment" | "revenue">,
): Promise<ManagedComparisonData | null> {
  const [ads, conversations] = await Promise.all([
    insightsProvider
      ? buildAdsComparison(ctx, insightsProvider, baselineStore, stores.revenue)
      : Promise.resolve(null),
    buildConversationsComparison(ctx, stores),
  ]);
  if (!ads && !conversations) return null;
  return {
    ads,
    conversations,
    source: ads ? "pre-switchboard-baseline" : "in-period-cohort",
    emptyMessage: !ads && !conversations ? "Comparison unlocks after 30 days." : undefined,
  };
}
