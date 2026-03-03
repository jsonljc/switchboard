import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";
import { percentChange } from "../../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Reach Saturation Advisor (Brand Vertical)
// ---------------------------------------------------------------------------
// Detects when increased spend is no longer producing incremental unique
// reach — a sign that the audience pool is saturated and additional budget
// is just increasing frequency on the same users.
//
// Pattern: Spend up but unique reach flat or declining.
// ---------------------------------------------------------------------------

export const reachSaturationAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  _context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  const currentReach = current.topLevel.reach ?? 0;
  const previousReach = previous.topLevel.reach ?? 0;

  // Need reach data in both periods
  if (currentReach === 0 || previousReach === 0) return findings;

  const spendChange = percentChange(current.spend, previous.spend);
  const reachChange = percentChange(currentReach, previousReach);

  // Spend increased significantly but reach is flat or declining
  if (spendChange > 15 && reachChange < 5) {
    const severity = reachChange < -5 ? ("critical" as const) : ("warning" as const);

    findings.push({
      severity,
      stage: "reach",
      message: `Reach saturation: spend increased ${spendChange.toFixed(1)}% but unique reach ${reachChange < 0 ? "declined" : "only grew"} ${reachChange.toFixed(1)}%. Additional budget is increasing frequency on existing users rather than reaching new ones.`,
      recommendation:
        severity === "critical"
          ? "The audience pool is exhausted. Expand targeting significantly — broaden interest targeting, increase lookalike percentages, or test new audience segments. Consider pausing and relaunching with fresh targeting to reset reach curves."
          : "Incremental reach is slowing. Begin testing broader audiences or new audience segments before the saturation worsens. Consider shifting some budget to different platforms where you can reach unique users.",
    });
  }

  // Healthy reach growth
  if (spendChange > 10 && reachChange > spendChange * 0.8) {
    findings.push({
      severity: "healthy",
      stage: "reach",
      message: `Reach scaling efficiently: +${reachChange.toFixed(1)}% unique reach with +${spendChange.toFixed(1)}% spend.`,
      recommendation: null,
    });
  }

  return findings;
};
