import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Learning Instability Advisor
// ---------------------------------------------------------------------------
// Detects when a large portion of spend is going to ad sets that are in
// the learning phase AND were recently edited. Frequent edits during
// learning phase reset the algorithm, preventing optimization.
//
// Rule: >30% of spend in learning-phase ad sets edited within 3 days
// Gracefully skips when daysSinceLastEdit is null (e.g., Google).
// ---------------------------------------------------------------------------

export const learningInstabilityAdvisor: FindingAdvisor = (
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
  const totalSpend = activeEntities.reduce((sum, e) => sum + e.spend, 0);

  if (totalSpend === 0) return findings;

  // Find ad sets that are in learning phase and were recently edited
  const unstableEntities = activeEntities.filter(
    (e) =>
      e.inLearningPhase &&
      e.daysSinceLastEdit !== null &&
      e.daysSinceLastEdit <= 3
  );

  if (unstableEntities.length === 0) return findings;

  const unstableSpend = unstableEntities.reduce(
    (sum, e) => sum + e.spend,
    0
  );
  const unstablePercent = (unstableSpend / totalSpend) * 100;

  if (unstablePercent > 30) {
    findings.push({
      severity: unstablePercent > 60 ? "critical" : "warning",
      stage: "account_structure",
      message: `Learning instability: ${unstablePercent.toFixed(1)}% of spend ($${unstableSpend.toFixed(2)}) is in ${unstableEntities.length} ad set${unstableEntities.length !== 1 ? "s" : ""} that are in learning phase and were edited within the last 3 days. Frequent edits reset the learning algorithm.`,
      recommendation:
        "Avoid making changes to ad sets during the learning phase. Wait at least 7 days after creation or significant budget changes before making further edits. Each edit restarts the learning process and wastes the spend already invested in optimization.",
    });
  }

  return findings;
};
