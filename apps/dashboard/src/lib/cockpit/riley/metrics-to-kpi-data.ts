import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import type { CockpitKpiData } from "@/components/cockpit/types";

/**
 * Strict, typed pass-through. Returns null when the wire VM lacks `tiles` or
 * `roi` — the cockpit page renders no KPI strip in that case rather than
 * falling back to Alex's `legacyTiles()` derivation (which would leak a
 * `qualified` tile onto /riley).
 */
export function metricsViewModelToRileyKpiData(vm: MetricsViewModelWire): CockpitKpiData | null {
  if (!vm.tiles || !vm.roi) return null;
  return {
    range: `This week · ${vm.folioRange}`,
    tiles: [...vm.tiles],
    roi: vm.roi,
  };
}
