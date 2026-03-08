// ---------------------------------------------------------------------------
// Auto-Budget Advisor
// ---------------------------------------------------------------------------
// Identifies over/under-funded campaigns and suggests reallocation.
// ---------------------------------------------------------------------------

import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
  Severity,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

export const autoBudgetAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  if (!context?.subEntities || context.subEntities.length < 2) return findings;

  const noConversions = context.subEntities.filter((e) => e.conversions === 0 && e.spend > 50);
  if (noConversions.length > 0) {
    const totalWaste = noConversions.reduce((s, e) => s + e.spend, 0);
    findings.push({
      severity: totalWaste > 200 ? ("critical" as Severity) : ("warning" as Severity),
      stage: "budget",
      message: `$${totalWaste.toFixed(2)} spent across ${noConversions.length} entity/entities with zero conversions`,
      recommendation:
        "Consider pausing these entities or reallocating their budget to better performers. Use digital-ads.budget.recommend for detailed analysis.",
    });
  }

  return findings;
};
