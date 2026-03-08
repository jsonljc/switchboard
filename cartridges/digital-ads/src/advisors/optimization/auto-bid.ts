// ---------------------------------------------------------------------------
// Auto-Bid Advisor
// ---------------------------------------------------------------------------
// Detects bid strategy mismatches and suggests improvements.
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

export const autoBidAdvisor: FindingAdvisor = (
  stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  _context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  const convStage = stageAnalysis.find(
    (s) => s.metric === "purchase" || s.metric === "lead",
  );

  if (convStage && Math.abs(convStage.deltaPercent) > 30 && convStage.currentValue > 0) {
    findings.push({
      severity: "warning" as Severity,
      stage: "bid_strategy",
      message: `Cost per conversion swung ${convStage.deltaPercent > 0 ? "+" : ""}${convStage.deltaPercent.toFixed(0)}% week-over-week — bid strategy may need adjustment`,
      recommendation:
        "High CPA volatility suggests the current bid strategy may not be optimal. Use digital-ads.bid.update_strategy to switch to COST_CAP for more stable delivery.",
    });
  }

  return findings;
};
