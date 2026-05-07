import type { MetricsViewModel, PerAgentBuilderInput } from "./metrics.js";

export async function buildRileyMetricsViewModel(
  _input: PerAgentBuilderInput,
): Promise<MetricsViewModel> {
  return {
    hero: { kind: "ad-leads", value: 0, comparator: { window: "week", value: 0 } },
    heroSubProseSegments: [],
    spark: [],
    stats: [
      { label: "Leads", display: "0", rawValue: 0, unit: "count" },
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
    ],
    freshness: {
      generatedAt: _input.week.now.toISOString(),
      window: "week",
      dataSource: "live",
      unavailableSources: ["ad-platform-ctr", "ad-platform-spend"],
    },
    folioRange: _input.week.folioRange,
  };
}
