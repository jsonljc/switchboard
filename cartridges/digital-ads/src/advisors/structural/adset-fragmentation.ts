import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Adset Fragmentation Advisor
// ---------------------------------------------------------------------------
// Detects when an account has too many active ad sets relative to the
// conversion volume, causing each ad set to be starved of data and
// preventing the algorithm from optimizing effectively.
//
// Rule: >10 active ad sets AND average conversions/adset < 5/week
// ---------------------------------------------------------------------------

export const adsetFragmentationAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext
): Finding[] => {
  if (!context?.subEntities || context.subEntities.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  const activeEntities = context.subEntities.filter((e) => e.spend > 0);
  const totalEntities = activeEntities.length;

  if (totalEntities <= 10) return findings;

  const totalConversions = activeEntities.reduce(
    (sum, e) => sum + e.conversions,
    0
  );
  const avgConversions = totalConversions / totalEntities;

  if (avgConversions < 5) {
    const recommendedCount = Math.max(
      Math.ceil(totalConversions / 50),
      1
    );

    findings.push({
      severity: avgConversions < 2 ? "critical" : "warning",
      stage: "account_structure",
      message: `Ad set fragmentation detected: ${totalEntities} active ad sets averaging only ${avgConversions.toFixed(1)} conversions each. The algorithm needs ~50 conversions/week per ad set to optimize effectively.`,
      recommendation: `Consolidate to approximately ${recommendedCount} ad set${recommendedCount !== 1 ? "s" : ""} to concentrate conversion volume. Merge similar audiences and let the algorithm find the best segments within fewer, broader ad sets.`,
    });
  }

  return findings;
};
