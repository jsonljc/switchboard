import type { MetricsViewModel, PerAgentBuilderInput } from "./metrics.js";

export async function buildAlexMetricsViewModel(
  _input: PerAgentBuilderInput,
): Promise<MetricsViewModel> {
  return {
    hero: { kind: "tours-booked", value: 0, comparator: { window: "week", value: 0 } },
    heroSubProseSegments: [],
    spark: [],
    stats: [
      { label: "Leads", display: "0", rawValue: 0, unit: "count" },
      { label: "Conversion", display: "0%", rawValue: 0, unit: "percent" },
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
      unavailableSources: ["ad-platform-spend"],
    },
    folioRange: _input.week.folioRange,
  };
}
