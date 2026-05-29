import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import type { CockpitKpiData } from "@/components/cockpit/types";

/**
 * Strict, typed pass-through for Mira (mirrors riley/metrics-to-kpi-data.ts).
 * Returns null when the wire VM lacks `tiles` — the cockpit page renders no KPI
 * strip in that case rather than falling back to Alex's `legacyTiles()`
 * derivation (which would leak a `qualified` tile onto /mira).
 *
 * Unlike the Riley adapter, Mira's metrics carry NO `roi` (creative drafts have
 * no return-on-spend), so we emit an explicit `roi: null`. That null tells
 * <KPIStrip> to SUPPRESS the ROI bar rather than fall through to legacyRoi()
 * (which, with spend===null, renders a misleading "Connect Meta Ads to see
 * return on spend" row on a draft-only creative agent).
 */
export function metricsViewModelToMiraKpiData(vm: MetricsViewModelWire): CockpitKpiData | null {
  if (!vm.tiles) return null;
  return {
    range: `This week · ${vm.folioRange}`,
    roi: null,
    tiles: vm.tiles.map((t) => ({
      label: t.label,
      value: typeof t.value === "number" ? String(t.value) : t.value,
      ...(t.unavailable ? { unavailable: true } : {}),
      ...(t.hint ? { hint: t.hint } : {}),
      ...(t.trend ? { trend: t.trend } : {}),
    })),
  };
}
