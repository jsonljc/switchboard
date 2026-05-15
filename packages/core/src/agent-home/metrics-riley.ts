import type {
  KpiTile,
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  RoiBar,
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
  const bookedDeltaStr = formatNumericDelta(heroValue, heroPrev);

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

  const spendDollars = spendCents !== null ? Math.round(spendCents / 100) : null;
  const cpl =
    spendCents !== null && heroValue > 0 ? Math.round(spendCents / 100 / heroValue) : null;
  let cplDisplay = "—";
  if (cpl !== null) cplDisplay = cpl === 0 ? "<$1 per lead" : `$${cpl} per lead`;
  // Riley v1 reinterprets `targetCpbCents` as **target cost per lead** for the
  // ROI comparator. The config key is shared with Alex (target cost per
  // booking) for storage symmetry — `AgentRoster.config.targetCpbCents` is a
  // single value; the meaning is agent-side. Do not treat Riley's target as
  // booking economics until Riley has booking attribution (future slice).
  const targetDollars =
    targets.targetCpbCents !== null ? Math.round(targets.targetCpbCents / 100) : null;
  const targetLabel = targetDollars !== null ? `target $${targetDollars}` : "—";

  const tiles: readonly KpiTile[] = [
    {
      label: "leads",
      value: heroValue,
      ...(bookedDeltaStr ? { trend: bookedDeltaStr } : {}),
    },
    { label: "ctr", value: "—", unavailable: true },
    spendDollars !== null
      ? { label: "ad spend", value: `$${spendDollars}` }
      : { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" },
  ];

  const roi: RoiBar = (() => {
    // Rule 1: spendCents === null
    if (spendCents === null) {
      return {
        degraded: true,
        degradedHint: "Connect Meta Ads to see cost per lead",
        label: "cost per lead",
        comparator: { value: "—", target: targetLabel },
      };
    }
    // Rule 2: spendCents !== null && leads <= 0
    if (heroValue <= 0) {
      return {
        degraded: true,
        degradedHint: "",
        label: "cost per lead",
        comparator: { value: "—", target: targetLabel },
      };
    }
    // Rules 3 + 4: spendCents !== null && leads > 0
    return {
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: {
        value: cplDisplay,
        target: targetLabel,
      },
    };
  })();

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
    bookedDelta: bookedDeltaStr,
    leadsDelta: bookedDeltaStr,
    qualifiedDelta: formatPercentPointsDelta(qualifiedPct, qualifiedPrev),
    tiles,
    roi,
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
