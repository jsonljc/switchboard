// ---------------------------------------------------------------------------
// Learning Phase Health Advisor
// ---------------------------------------------------------------------------
// Warns on stuck/limited learning, frequent resets.
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

export const learningPhaseHealthAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  if (!context?.subEntities) return findings;

  const learningEntities = context.subEntities.filter((e) => e.inLearningPhase);
  const totalEntities = context.subEntities.length;

  if (learningEntities.length > 0) {
    const learningPct =
      totalEntities > 0 ? ((learningEntities.length / totalEntities) * 100).toFixed(0) : "0";

    if (learningEntities.length > totalEntities * 0.5) {
      findings.push({
        severity: "critical" as Severity,
        stage: "learning_phase",
        message: `${learningEntities.length} of ${totalEntities} ad sets (${learningPct}%) are in learning phase — majority of budget is in unoptimized delivery`,
        recommendation:
          "Too many ad sets in learning phase. Consider consolidating ad sets to exit learning faster. Avoid making changes to ad sets currently in learning.",
      });
    } else {
      findings.push({
        severity: "warning" as Severity,
        stage: "learning_phase",
        message: `${learningEntities.length} ad set(s) in learning phase (${learningPct}% of total)`,
        recommendation:
          "Avoid budget or targeting changes to these ad sets until they exit learning. Use digital-ads.account.learning_phase for detailed status.",
      });
    }
  }

  // Check for ad sets with very low spend that may be stuck
  const lowSpendInLearning = learningEntities.filter((e) => e.spend < (e.dailyBudget ?? 50) * 0.3);
  if (lowSpendInLearning.length > 0) {
    findings.push({
      severity: "warning" as Severity,
      stage: "learning_phase",
      message: `${lowSpendInLearning.length} ad set(s) in learning with spend <30% of daily budget — likely Learning Limited`,
      recommendation:
        "These ad sets may not exit learning. Consider increasing budget, broadening targeting, or combining with other ad sets.",
    });
  }

  return findings;
};
