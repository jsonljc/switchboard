import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";
import { percentChange } from "../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Marginal Efficiency Advisor
// ---------------------------------------------------------------------------
// Detects diminishing returns: when increased spend doesn't produce
// proportional conversion increases. This is the most important efficiency
// question for scaling advertisers.
//
// "Spend up 30% but conversions up only 10%" means marginal CPA is 3x
// blended CPA — far past the point of diminishing returns.
//
// Data: computable from existing spend + conversion deltas. No new API calls.
// ---------------------------------------------------------------------------

export const marginalEfficiencyAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  _context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  const currentSpend = current.spend;
  const previousSpend = previous.spend;

  // Only analyze when spend increased — diminishing returns is a scaling issue
  if (previousSpend <= 0 || currentSpend <= previousSpend) return findings;

  const spendDelta = currentSpend - previousSpend;
  const spendChangePercent = percentChange(currentSpend, previousSpend);

  // Need a meaningful spend increase to detect marginal returns
  if (spendChangePercent < 10) return findings;

  // Find conversion counts from the primary KPI stages
  // Check common conversion metrics in topLevel
  const currentConversions = extractConversions(current);
  const previousConversions = extractConversions(previous);

  if (previousConversions <= 0 || currentConversions <= 0) return findings;

  const conversionDelta = currentConversions - previousConversions;

  // Compute blended and marginal CPA
  const blendedCPA = currentSpend / currentConversions;

  if (conversionDelta <= 0) {
    // Spend went up but conversions went down or flat — severe diminishing returns
    findings.push({
      severity: "critical",
      stage: "efficiency",
      message: `Spend increased ${spendChangePercent.toFixed(1)}% (+$${spendDelta.toFixed(2)}) but conversions did not increase (${previousConversions} → ${currentConversions}). The incremental spend produced zero additional conversions.`,
      recommendation:
        "The additional budget is being wasted. Pull back to the previous spend level and reallocate the excess budget to other campaigns or platforms showing positive marginal returns.",
    });
    return findings;
  }

  const marginalCPA = spendDelta / conversionDelta;
  const marginalRatio = marginalCPA / blendedCPA;

  if (marginalRatio > 3) {
    findings.push({
      severity: "critical",
      stage: "efficiency",
      message: `Severe diminishing returns: spend increased ${spendChangePercent.toFixed(1)}% but conversions only grew ${percentChange(currentConversions, previousConversions).toFixed(1)}%. Marginal CPA ($${marginalCPA.toFixed(2)}) is ${marginalRatio.toFixed(1)}x blended CPA ($${blendedCPA.toFixed(2)}).`,
      recommendation:
        "Scale back spend to the previous level. The marginal cost per acquisition is far above efficient levels. Redirect budget to platforms/campaigns with better marginal returns, or invest in expanding audiences before increasing spend.",
    });
  } else if (marginalRatio > 2) {
    findings.push({
      severity: "warning",
      stage: "efficiency",
      message: `Diminishing returns detected: spend increased ${spendChangePercent.toFixed(1)}% but conversions only grew ${percentChange(currentConversions, previousConversions).toFixed(1)}%. Marginal CPA ($${marginalCPA.toFixed(2)}) is ${marginalRatio.toFixed(1)}x blended CPA ($${blendedCPA.toFixed(2)}).`,
      recommendation:
        "The spend increase is producing conversions at above-average cost. Consider moderating the budget increase or expanding audience reach before scaling further. Each additional dollar is buying less efficient results.",
    });
  } else if (marginalRatio < 0.85 && spendChangePercent > 15) {
    // Marginal CPA better than blended — there's room to scale
    findings.push({
      severity: "healthy",
      stage: "efficiency",
      message: `Efficient scaling: spend increased ${spendChangePercent.toFixed(1)}% and marginal CPA ($${marginalCPA.toFixed(2)}) is ${(marginalRatio * 100).toFixed(0)}% of blended CPA ($${blendedCPA.toFixed(2)}). There may be room to scale further.`,
      recommendation: null,
    });
  }

  return findings;
};

/**
 * Extract the best available total conversion count from a snapshot.
 * Checks multiple common conversion metrics across platforms.
 */
function extractConversions(snapshot: MetricSnapshot): number {
  const tl = snapshot.topLevel;

  // Check stages for purchase/conversion counts
  for (const [, stageData] of Object.entries(snapshot.stages)) {
    if (stageData.count > 0 && stageData.cost !== null) {
      // This is likely the primary conversion stage
      return stageData.count;
    }
  }

  // Fallback to topLevel fields
  return tl.conversions ?? tl.complete_payment ?? tl.conversion ?? 0;
}
