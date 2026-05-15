import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
} from "./metrics-types.js";
import { formatNumericDelta, formatPercentPointsDelta } from "./metrics-deltas.js";

const RILEY_VOICE = {
  up: (delta: number) => `+${delta} from last week.`,
  down: (delta: number) => `${Math.abs(delta)} fewer from last week.`,
  flat: () => `Flat vs last week.`,
};

export async function buildRileyMetricsViewModel(
  input: PerAgentBuilderInput,
): Promise<MetricsViewModel> {
  const { orgId, week, store, targets } = input;

  const heroValueP = countLeads(store, orgId, week.weekStart, week.weekEnd);
  const heroPrevP = countLeads(store, orgId, week.prevWeekStart, week.prevWeekEnd);
  const spendCentsP = store.getMetaSpendCents({ orgId, from: week.weekStart, to: week.weekEnd });
  const weeklyCountsP = Promise.all(
    week.weeklyBuckets.map((b) => countLeads(store, orgId, b.from, b.to)),
  );
  const dailyCountsP = Promise.all(
    week.dailyBuckets.map((b) => countLeads(store, orgId, b.from, b.to)),
  );

  const [heroValue, heroPrev, spendCents, weeklyCounts, dailyCounts] = await Promise.all([
    heroValueP,
    heroPrevP,
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

  const delta = heroValue - heroPrev;
  const subprose: ProseSegment[] = [{ kind: "text", text: voiceText(delta) }];

  // Riley's "leads" is the hero value (ad leads); qualifiedPct is not meaningful for Riley
  // but the shape requires it. Use 0 as the neutral value.
  const leads = heroValue;
  const qualifiedPct = 0;
  const qualifiedPrev: number | null = null;

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
        },
  ];

  const unavailableSources: string[] = ["ad-platform-ctr"];
  if (spendCents === null) unavailableSources.push("ad-platform-spend");

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
      unavailableSources,
    },
    folioRange: week.folioRange,
    targets,
    spendCents,
    leads,
    qualifiedPct,
    bookedDelta: formatNumericDelta(heroValue, heroPrev),
    leadsDelta: formatNumericDelta(heroValue, heroPrev),
    qualifiedDelta: formatPercentPointsDelta(qualifiedPct, qualifiedPrev),
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
