import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Budget Pacing Advisor
// ---------------------------------------------------------------------------
// Compares actual spend vs allocated daily budget to detect:
// - Under-delivery (<70%): signals audience exhaustion, bid ceiling, or
//   restrictive targeting. The algorithm can't find enough people to show
//   ads to at the current bid.
// - Budget-capped (>95%): the algorithm is hitting the budget ceiling and
//   stopping delivery of potentially efficient impressions.
//
// Data: dailyBudget from SubEntityBreakdown (already fetched by platform
// clients as part of structural analysis).
// ---------------------------------------------------------------------------

export const budgetPacingAdvisor: FindingAdvisor = (
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
  const entitiesWithBudget = context.subEntities.filter(
    (e) => e.dailyBudget !== null && e.dailyBudget > 0 && e.spend > 0
  );

  if (entitiesWithBudget.length === 0) return findings;

  let underDeliveryCount = 0;
  let budgetCappedCount = 0;
  let totalUnderDeliverySpend = 0;
  let totalCappedBudget = 0;

  for (const entity of entitiesWithBudget) {
    const budget = entity.dailyBudget!;
    // Spend is for the full period; normalize to daily
    // Assume 7-day period for WoW analysis
    const dailySpend = entity.spend / 7;
    const utilization = dailySpend / budget;

    if (utilization < 0.7) {
      underDeliveryCount++;
      totalUnderDeliverySpend += entity.spend;
    } else if (utilization > 0.95) {
      budgetCappedCount++;
      totalCappedBudget += budget * 7; // weekly budget capacity
    }
  }

  if (underDeliveryCount > 0) {
    const pct = ((underDeliveryCount / entitiesWithBudget.length) * 100).toFixed(0);
    findings.push({
      severity: underDeliveryCount > entitiesWithBudget.length * 0.5 ? "warning" : "info",
      stage: "budget_pacing",
      message: `Under-delivery detected: ${underDeliveryCount} of ${entitiesWithBudget.length} ad sets (${pct}%) are spending less than 70% of their daily budget ($${totalUnderDeliverySpend.toFixed(2)} total spend).`,
      recommendation:
        "Under-delivery typically means the algorithm can't find enough eligible users at the current bid/targeting. Check for: overly narrow audiences, bid caps that are too low, restrictive placement exclusions, or creative that fails ad review. Consider broadening targeting or increasing bids.",
    });
  }

  if (budgetCappedCount > 0) {
    const pct = ((budgetCappedCount / entitiesWithBudget.length) * 100).toFixed(0);
    findings.push({
      severity: budgetCappedCount > entitiesWithBudget.length * 0.5 ? "warning" : "info",
      stage: "budget_pacing",
      message: `Budget-capped delivery: ${budgetCappedCount} of ${entitiesWithBudget.length} ad sets (${pct}%) are spending >95% of their daily budget ($${totalCappedBudget.toFixed(2)} weekly budget capacity).`,
      recommendation:
        "Budget-capped ad sets may be leaving efficient impressions on the table. If CPA is within target, increase the daily budget by 20-30% to test whether marginal spend produces good returns. If using CBO (Campaign Budget Optimization), the algorithm should handle this automatically.",
    });
  }

  return findings;
};
