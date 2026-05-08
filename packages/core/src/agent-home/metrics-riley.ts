import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics.js";

const RILEY_VOICE = {
  up: (delta: number) => `+${delta} from last week.`,
  down: (delta: number) => `${delta} from last week.`, // delta already negative
  flat: () => `Flat vs last week.`,
};

export async function buildRileyMetricsViewModel(
  input: PerAgentBuilderInput,
): Promise<MetricsViewModel> {
  const { orgId, week, store } = input;

  const heroValueP = countLeads(store, orgId, week.weekStart, week.weekEnd);
  const heroPrevP = countLeads(store, orgId, week.prevWeekStart, week.prevWeekEnd);
  const weeklyCountsP = Promise.all(
    week.weeklyBuckets.map((b) => countLeads(store, orgId, b.from, b.to)),
  );
  const dailyCountsP = Promise.all(
    week.dailyBuckets.map((b) => countLeads(store, orgId, b.from, b.to)),
  );

  const [heroValue, heroPrev, weeklyCounts, dailyCounts] = await Promise.all([
    heroValueP,
    heroPrevP,
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

  const delta = heroValue - heroPrev;
  const subprose: ProseSegment[] = [{ kind: "text", text: voiceText(delta) }];

  const stats: readonly [StatCell, StatCell, StatCell] = [
    {
      label: "Leads",
      display: String(heroValue),
      rawValue: heroValue,
      unit: "count",
    },
    {
      label: "CTR",
      display: "—",
      rawValue: null,
      unit: "percent",
      unavailable: true,
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
      kind: "ad-leads",
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
      unavailableSources: ["ad-platform-ctr", "ad-platform-spend"],
    },
    folioRange: week.folioRange,
  };
}

function countLeads(
  store: MetricsSignalStore,
  orgId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return store.countConversionsByType({ orgId, type: "lead", from, to });
}

function voiceText(delta: number): string {
  if (delta > 0) return RILEY_VOICE.up(delta);
  if (delta < 0) return RILEY_VOICE.down(delta);
  return RILEY_VOICE.flat();
}
