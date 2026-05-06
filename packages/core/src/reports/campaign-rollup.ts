import type { CampaignRow, ReportInsightsProvider } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeCampaignRollup(
  ctx: RollupContext,
  insightsProvider: ReportInsightsProvider | null,
  revenueStore: Pick<ReportStores["revenue"], "revenueByCampaign">,
): Promise<CampaignRow[]> {
  if (!insightsProvider) return [];

  const dateRange = {
    since: formatDate(ctx.current.start),
    until: formatDate(ctx.current.end),
  };

  const [campaigns, revenueRows] = await Promise.all([
    insightsProvider.getCampaignMetrics(dateRange),
    revenueStore.revenueByCampaign({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
  ]);

  const revenueMap = new Map<string, number>();
  for (const r of revenueRows) {
    revenueMap.set(r.sourceCampaignId, r.totalAmount);
  }

  const rows: CampaignRow[] = campaigns.map((c) => {
    const revenue = revenueMap.get(c.campaignId) ?? 0;
    return {
      name: c.campaignName,
      spend: c.spend,
      impressions: c.impressions,
      inlineLinkClicks: c.inlineLinkClicks,
      costPerInlineLinkClick: c.costPerInlineLinkClick,
      inlineLinkClickCtr: c.inlineLinkClickCtr,
      leads: c.conversions,
      revenue,
      cpl: c.conversions > 0 ? c.spend / c.conversions : null,
      clickToLeadRate: c.inlineLinkClicks > 0 ? c.conversions / c.inlineLinkClicks : null,
      roas: c.spend > 0 ? revenue / c.spend : 0,
    };
  });

  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}
