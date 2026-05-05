import type { AttributionData, Delta } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function isRiley(row: {
  firstTouchSourceAdId: string | null;
  firstTouchSourceCampaignId: string | null;
}): boolean {
  return !!(row.firstTouchSourceAdId || row.firstTouchSourceCampaignId);
}

function computeDelta(current: number, prior: number): Delta {
  if (prior === 0 && current === 0) return { kind: "flat", text: "no prior data" };
  if (prior === 0) return { kind: "pos", text: "new" };
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct > 0) return { kind: "pos", text: `+${pct} %` };
  if (pct < 0) return { kind: "neg", text: `${pct} %` };
  return { kind: "flat", text: "0 %" };
}

export async function computeAttribution(
  ctx: RollupContext,
  stores: Pick<ReportStores, "revenue" | "conversions">,
): Promise<AttributionData> {
  const [currentRevenue, priorRevenue, currentLeads] = await Promise.all([
    stores.revenue.revenueWithFirstTouch({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
    stores.revenue.revenueWithFirstTouch({
      orgId: ctx.orgId,
      from: ctx.prior.start,
      to: ctx.prior.end,
    }),
    stores.conversions.leadsBySource({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
  ]);

  let rileyRevenue = 0;
  let alexRevenue = 0;
  for (const e of currentRevenue) {
    if (isRiley(e)) {
      rileyRevenue += e.amount;
    } else {
      alexRevenue += e.amount;
    }
  }

  let priorTotal = 0;
  for (const e of priorRevenue) {
    priorTotal += e.amount;
  }

  const total = rileyRevenue + alexRevenue;
  const delta = computeDelta(total, priorTotal);

  const rileyLeads = currentLeads.filter((l) => !!(l.sourceAdId || l.sourceCampaignId));
  const alexLeads = currentLeads.filter((l) => !l.sourceAdId && !l.sourceCampaignId);
  const campaignIds = new Set(rileyLeads.map((l) => l.sourceCampaignId).filter(Boolean));

  return {
    total,
    delta,
    riley: {
      value: rileyRevenue,
      caption: `${campaignIds.size} campaign${campaignIds.size !== 1 ? "s" : ""} · ${rileyLeads.length} lead${rileyLeads.length !== 1 ? "s" : ""}`,
    },
    alex: {
      value: alexRevenue,
      caption: `chat · ${alexLeads.length} lead${alexLeads.length !== 1 ? "s" : ""}`,
    },
  };
}
