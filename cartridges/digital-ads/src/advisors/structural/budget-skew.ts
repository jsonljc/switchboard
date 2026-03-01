import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Budget Skew Advisor
// ---------------------------------------------------------------------------
// Detects when spend is over-concentrated in a single ad set, which creates
// portfolio risk — if that one ad set fatigues or hits an audience ceiling,
// the entire account's performance degrades at once.
//
// Rule: any single ad set consumes >60% of total spend
// ---------------------------------------------------------------------------

export const budgetSkewAdvisor: FindingAdvisor = (
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

  if (totalSpend === 0 || activeEntities.length < 2) return findings;

  for (const entity of activeEntities) {
    const spendShare = entity.spend / totalSpend;

    if (spendShare > 0.6) {
      const percentShare = (spendShare * 100).toFixed(1);

      findings.push({
        severity: spendShare > 0.8 ? "critical" : "warning",
        stage: "account_structure",
        message: `Budget skew detected: ad set ${entity.entityId} consumes ${percentShare}% of total spend ($${entity.spend.toFixed(2)} of $${totalSpend.toFixed(2)}). This concentration creates risk if that ad set underperforms.`,
        recommendation:
          spendShare > 0.8
            ? "This level of concentration is risky. Redistribute budget across 2-3 additional ad sets with different targeting to reduce single-point-of-failure risk. If this is intentional (e.g., a proven winner), consider creating backup ad sets with similar targeting."
            : "Consider redistributing some budget to diversify risk. If this ad set is intentionally dominant, verify it's still performing well and create backup ad sets.",
      });
    }
  }

  return findings;
};
