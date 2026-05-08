import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics.js";

const ALEX_VOICE = {
  up: (prev: number) => `Up from ${prev} last week.`,
  down: (prev: number) => `Down from ${prev} last week.`,
  flat: () => `Flat vs last week.`,
};

const EXCLUDE_STATUSES = ["cancelled"] as const;

export async function buildAlexMetricsViewModel(
  input: PerAgentBuilderInput,
): Promise<MetricsViewModel> {
  const { orgId, week, store } = input;

  const heroValueP = countBookings(store, orgId, week.weekStart, week.weekEnd);
  const heroPrevP = countBookings(store, orgId, week.prevWeekStart, week.prevWeekEnd);
  const leadsP = store.countConversionsByType({
    orgId,
    type: "lead",
    from: week.weekStart,
    to: week.weekEnd,
  });
  const weeklyCountsP = Promise.all(
    week.weeklyBuckets.map((b) => countBookings(store, orgId, b.from, b.to)),
  );
  const dailyCountsP = Promise.all(
    week.dailyBuckets.map((b) => countBookings(store, orgId, b.from, b.to)),
  );

  const [heroValue, heroPrev, leads, weeklyCounts, dailyCounts] = await Promise.all([
    heroValueP,
    heroPrevP,
    leadsP,
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
    {
      label: "Spend",
      display: "—",
      rawValue: null,
      unit: "currency",
      unavailable: true,
    },
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
      unavailableSources: ["ad-platform-spend"],
    },
    folioRange: week.folioRange,
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

function voiceText(current: number, prev: number): string {
  if (current > prev) return ALEX_VOICE.up(prev);
  if (current < prev) return ALEX_VOICE.down(prev);
  return ALEX_VOICE.flat();
}
