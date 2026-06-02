import type { WeekContext } from "./metrics-buckets.js";
import type { MetricsViewModel, ProseSegment, StatCell, KpiTile } from "./metrics-types.js";
import type { MiraCreativeCounts } from "../creative-read-model/types.js";

export interface BuildMiraMetricsInput {
  counts: MiraCreativeCounts;
  week: WeekContext;
}

export function buildMiraMetricsViewModel(input: BuildMiraMetricsInput): MetricsViewModel {
  const { counts, week } = input;
  const delta = counts.shippedThisWeek - counts.shippedPrevWeek;
  const subprose: ProseSegment[] = [{ kind: "text", text: voiceText(delta) }];

  const stats: readonly [StatCell, StatCell, StatCell] = [
    {
      label: "Drafts completed",
      display: String(counts.shippedThisWeek),
      rawValue: counts.shippedThisWeek,
      unit: "count",
    },
    {
      label: "Awaiting review",
      display: String(counts.awaitingReview),
      rawValue: counts.awaitingReview,
      unit: "count",
    },
    {
      label: "In flight",
      display: String(counts.inFlight),
      rawValue: counts.inFlight,
      unit: "count",
    },
  ];

  const tiles: readonly KpiTile[] = [
    { label: "drafts completed", value: counts.shippedThisWeek },
    { label: "awaiting review", value: counts.awaitingReview },
    { label: "in flight", value: counts.inFlight },
  ];

  return {
    hero: {
      kind: "creatives-shipped",
      value: counts.shippedThisWeek,
      comparator: { window: "week", value: counts.shippedPrevWeek },
    },
    heroSubProseSegments: subprose,
    spark: [],
    stats,
    freshness: { generatedAt: week.now.toISOString(), window: "week", dataSource: "live" },
    folioRange: week.folioRange,
    targets: { avgValueCents: null, targetCpbCents: null },
    spendCents: null,
    leads: 0,
    qualifiedPct: 0,
    showed: 0,
    bookedDelta: null,
    leadsDelta: null,
    qualifiedDelta: null,
    tiles,
  };
}

function voiceText(delta: number): string {
  if (delta > 0) return `+${delta} drafts completed vs last week.`;
  if (delta < 0) return `${Math.abs(delta)} fewer drafts completed vs last week.`;
  return `Flat vs last week.`;
}
