import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics-types.js";
import { formatNumericDelta, formatPercentPointsDelta } from "./metrics-deltas.js";

const ALEX_VOICE = {
  up: (prev: number) => `Up from ${prev} last week.`,
  down: (prev: number) => `Down from ${prev} last week.`,
  flat: () => `Flat vs last week.`,
};

const EXCLUDE_STATUSES = ["cancelled"] as const;

export async function buildAlexMetricsViewModel(
  input: PerAgentBuilderInput,
): Promise<MetricsViewModel> {
  const { orgId, week, store, targets } = input;

  const heroValueP = countBookings(store, orgId, week.weekStart, week.weekEnd);
  const heroPrevP = countBookings(store, orgId, week.prevWeekStart, week.prevWeekEnd);
  const leadsP = countLeads(store, orgId, week.weekStart, week.weekEnd);
  const leadsPrevP = countLeads(store, orgId, week.prevWeekStart, week.prevWeekEnd);
  const spendCentsP = store.getMetaSpendCents({ orgId, from: week.weekStart, to: week.weekEnd });
  const weeklyCountsP = Promise.all(
    week.weeklyBuckets.map((b) => countBookings(store, orgId, b.from, b.to)),
  );
  const dailyCountsP = Promise.all(
    week.dailyBuckets.map((b) => countBookings(store, orgId, b.from, b.to)),
  );

  const [heroValue, heroPrev, leads, leadsPrev, spendCents, weeklyCounts, dailyCounts] =
    await Promise.all([
      heroValueP,
      heroPrevP,
      leadsP,
      leadsPrevP,
      spendCentsP,
      weeklyCountsP,
      dailyCountsP,
    ]);

  const spark: SparkPoint[] = [
    ...week.weeklyBuckets.map((b, i) => ({ label: b.label, value: weeklyCounts[i] ?? 0 })),
    ...week.dailyBuckets.map((b, i) => ({
      label: b.label,
      value: dailyCounts[i] ?? 0,
      ...(b.isToday ? { isProjection: true } : {}),
    })),
  ];

  const subprose: ProseSegment[] = [{ kind: "text", text: voiceText(heroValue, heroPrev) }];

  const conversion = leads > 0 ? heroValue / leads : 0;
  const qualifiedPct = leads > 0 ? Math.round((heroValue / leads) * 100) : 0;
  const qualifiedPrev = leadsPrev > 0 ? Math.round((heroPrev / leadsPrev) * 100) : null;

  const spendCell: StatCell =
    spendCents !== null
      ? {
          label: "Spend",
          display: `$${Math.round(spendCents / 100)}`,
          rawValue: spendCents,
          unit: "currency",
          unavailable: false,
        }
      : {
          label: "Spend",
          display: "—",
          rawValue: null,
          unit: "currency",
          unavailable: true,
        };

  const stats: readonly [StatCell, StatCell, StatCell] = [
    {
      label: "Leads",
      display: String(leads),
      rawValue: leads,
      unit: "count",
    },
    {
      label: "Conversion",
      display: `${Math.round(conversion * 100)}%`,
      rawValue: conversion,
      unit: "percent",
    },
    spendCell,
  ];

  return {
    hero: {
      kind: "tours-booked",
      value: heroValue,
      comparator: { window: "week", value: heroPrev },
    },
    heroSubProseSegments: subprose,
    spark,
    stats,
    freshness: {
      generatedAt: week.now.toISOString(),
      window: "week",
      dataSource: "live",
      ...(spendCents === null ? { unavailableSources: ["ad-platform-spend"] as const } : {}),
    },
    folioRange: week.folioRange,
    targets,
    spendCents,
    leads,
    qualifiedPct,
    bookedDelta: formatNumericDelta(heroValue, heroPrev),
    leadsDelta: formatNumericDelta(leads, leadsPrev),
    qualifiedDelta: formatPercentPointsDelta(qualifiedPct, qualifiedPrev),
  };
}

function countBookings(
  store: MetricsSignalStore,
  orgId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return store.countBookingsCreated({
    orgId,
    excludeStatuses: EXCLUDE_STATUSES,
    from,
    to,
  });
}

function countLeads(
  store: MetricsSignalStore,
  orgId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return store.countConversionsByType({ orgId, type: "lead", from, to });
}

function voiceText(current: number, prev: number): string {
  if (current > prev) return ALEX_VOICE.up(prev);
  if (current < prev) return ALEX_VOICE.down(prev);
  return ALEX_VOICE.flat();
}
