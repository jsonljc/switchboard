import type { AttributionData, Delta } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import { centsToMajorUnits } from "./money-units.js";

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

  // revenueWithFirstTouch.amount is in MINOR units (cents); the digest renders these
  // via formatMoneyMajor and the dashboard via fmtSGD, both MAJOR-unit. Normalize to
  // major ONCE at this boundary (matching campaign/managed rollups) so the owner-facing
  // attributed-revenue figures aren't inflated 100x.
  let rileyRevenueCents = 0;
  let alexRevenueCents = 0;
  for (const e of currentRevenue) {
    if (isRiley(e)) {
      rileyRevenueCents += e.amount;
    } else {
      alexRevenueCents += e.amount;
    }
  }

  let priorTotalCents = 0;
  for (const e of priorRevenue) {
    priorTotalCents += e.amount;
  }

  const rileyRevenue = centsToMajorUnits(rileyRevenueCents);
  const alexRevenue = centsToMajorUnits(alexRevenueCents);
  const priorTotal = centsToMajorUnits(priorTotalCents);

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
