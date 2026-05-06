import type {
  FunnelRowData,
  FunnelNarrative,
  Delta,
  ReportInsightsProvider,
  ReportInsightsMetrics,
} from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

export const LPV_DISCLOSURE =
  "Landing Page Views are from Meta ad events. First-party website tracking is planned for a future release.";

function formatDateShort(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDelta(current: number, prior: number): Delta | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct > 0) return { kind: "pos", text: `+${pct} %` };
  if (pct < 0) return { kind: "neg", text: `${pct} %` };
  return { kind: "flat", text: "0 %" };
}

function fmtLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function fetchMetrics(
  provider: ReportInsightsProvider | null,
  start: Date,
  end: Date,
): Promise<ReportInsightsMetrics> {
  if (!provider) {
    return { impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 };
  }
  return provider.getAggregateMetrics({
    since: formatDateShort(start),
    until: formatDateShort(end),
  });
}

export async function computeFunnel(
  ctx: RollupContext,
  stores: Pick<ReportStores, "conversions" | "bookings" | "opportunities" | "recommendations">,
  provider: ReportInsightsProvider | null,
): Promise<{ funnel: FunnelRowData[]; funnelNarrative: FunnelNarrative }> {
  const noProvider = provider === null;

  const [
    currentMetrics,
    priorMetrics,
    currentLeads,
    priorLeads,
    currentBookings,
    priorBookings,
    currentCustomers,
    priorCustomers,
    narrative,
  ] = await Promise.all([
    fetchMetrics(provider, ctx.current.start, ctx.current.end),
    fetchMetrics(provider, ctx.prior.start, ctx.prior.end),
    stores.conversions.countByType(ctx.orgId, "lead", ctx.current.start, ctx.current.end),
    stores.conversions.countByType(ctx.orgId, "lead", ctx.prior.start, ctx.prior.end),
    stores.bookings.countExcludingStatuses({
      orgId: ctx.orgId,
      excludeStatuses: ["cancelled", "failed"],
      from: ctx.current.start,
      to: ctx.current.end,
    }),
    stores.bookings.countExcludingStatuses({
      orgId: ctx.orgId,
      excludeStatuses: ["cancelled", "failed"],
      from: ctx.prior.start,
      to: ctx.prior.end,
    }),
    stores.opportunities.countClosedWon({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
    stores.opportunities.countClosedWon({
      orgId: ctx.orgId,
      from: ctx.prior.start,
      to: ctx.prior.end,
    }),
    stores.recommendations.latestByAgent({
      orgId: ctx.orgId,
      agentKey: "riley",
      from: ctx.current.start,
      to: ctx.current.end,
    }),
  ]);

  const stages: Array<{ stage: string; current: number; prior: number; noProvider: boolean }> = [
    {
      stage: "Impressions",
      current: currentMetrics.impressions,
      prior: priorMetrics.impressions,
      noProvider,
    },
    { stage: "Clicks", current: currentMetrics.clicks, prior: priorMetrics.clicks, noProvider },
    {
      stage: "Landing page views",
      current: currentMetrics.landingPageViews,
      prior: priorMetrics.landingPageViews,
      noProvider,
    },
    { stage: "Leads", current: currentLeads, prior: priorLeads, noProvider: false },
    { stage: "Bookings", current: currentBookings, prior: priorBookings, noProvider: false },
    { stage: "Customers", current: currentCustomers, prior: priorCustomers, noProvider: false },
  ];

  const funnel: FunnelRowData[] = stages.map((s) => ({
    stage: s.stage,
    n: s.current,
    label: fmtLabel(s.current),
    delta: s.noProvider ? null : fmtDelta(s.current, s.prior),
  }));

  const funnelNarrative: FunnelNarrative = narrative
    ? {
        marker: "Riley",
        text: `${formatDateShort(narrative.date)} — ${narrative.humanSummary}`,
      }
    : {
        marker: "Riley",
        text: "No analysis available for this period.",
      };

  return { funnel, funnelNarrative };
}
