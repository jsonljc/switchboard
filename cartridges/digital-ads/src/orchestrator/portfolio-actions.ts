import type {
  PlatformResult,
  CrossPlatformFinding,
  BudgetRecommendation,
  PortfolioAction,
} from "./types.js";
import type { DiagnosticResult } from "../core/types.js";

// ---------------------------------------------------------------------------
// Portfolio Action Generator
// ---------------------------------------------------------------------------
// Produces a ranked list of portfolio-level actions by combining per-platform
// elasticity data, cross-platform findings, and budget recommendations into
// a single prioritized decision list.
// ---------------------------------------------------------------------------

/**
 * Generate ranked portfolio actions from multi-platform diagnostic results.
 *
 * Actions are ranked by: (1) estimated revenue recovery, (2) confidence score.
 * Each action gets a risk level based on the magnitude of budget shift required.
 */
export function generatePortfolioActions(
  platformResults: PlatformResult[],
  findings: CrossPlatformFinding[],
  budgetRecs: BudgetRecommendation[],
): PortfolioAction[] {
  const actions: PortfolioAction[] = [];

  const successfulResults = platformResults.filter(
    (r): r is PlatformResult & { result: DiagnosticResult } =>
      r.status === "success" && r.result !== undefined,
  );

  // Action 1: Platform-level elasticity-based actions
  for (const pr of successfulResults) {
    const result = pr.result;
    if (!result.elasticity || result.elasticity.impactRanking.length === 0) continue;

    const topImpact = result.elasticity.impactRanking[0]!;
    const revenueLoss = Math.abs(topImpact.estimatedRevenueDelta);

    // Only create actions for meaningful revenue impact
    if (revenueLoss < 10) continue;

    const confidence = computeConfidence(result);

    actions.push({
      priority: 0, // will be assigned after sorting
      action: `Fix ${topImpact.stage} bottleneck on ${pr.platform} — estimated $${revenueLoss.toFixed(0)}/period revenue loss`,
      platforms: [pr.platform],
      confidenceScore: confidence,
      estimatedRevenueRecovery: revenueLoss,
      riskLevel: "low", // fixing bottlenecks is low-risk
      requiredBudgetShiftPercent: null,
    });
  }

  // Action 2: Budget reallocation actions
  for (const rec of budgetRecs) {
    const shiftPercent = rec.suggestedShiftPercent ?? estimateShiftPercent(rec, successfulResults);
    const revenueRecovery =
      rec.estimatedKPIImprovement ?? estimateRevenueRecovery(rec, successfulResults);
    const riskLevel = computeRiskLevel(shiftPercent);

    actions.push({
      priority: 0,
      action: `Shift ${shiftPercent.toFixed(0)}% budget from ${rec.from} → ${rec.to}: ${rec.reason}`,
      platforms: [rec.from, rec.to],
      confidenceScore: rec.confidence === "high" ? 0.85 : rec.confidence === "medium" ? 0.6 : 0.35,
      estimatedRevenueRecovery: revenueRecovery,
      riskLevel,
      requiredBudgetShiftPercent: shiftPercent,
    });
  }

  // Action 3: Cross-platform finding actions
  for (const finding of findings) {
    if (finding.signal === "market_wide_cpm_increase") {
      actions.push({
        priority: 0,
        action: `Market-wide CPM increase detected — consider reducing spend until costs normalize`,
        platforms: finding.platforms,
        confidenceScore: finding.confidenceScore ?? 0.7,
        estimatedRevenueRecovery: finding.estimatedRevenueRecovery ?? 0,
        riskLevel: "medium",
        requiredBudgetShiftPercent: null,
      });
    }
  }

  // Sort by estimated revenue recovery (highest first), then by confidence
  actions.sort((a, b) => {
    const revDiff = b.estimatedRevenueRecovery - a.estimatedRevenueRecovery;
    if (Math.abs(revDiff) > 1) return revDiff;
    return b.confidenceScore - a.confidenceScore;
  });

  // Assign priority numbers
  for (let i = 0; i < actions.length; i++) {
    actions[i]!.priority = i + 1;
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute confidence score for a platform result.
 * Higher when: KPI delta is large, multiple corroborating signals exist.
 */
function computeConfidence(result: DiagnosticResult): number {
  const kpiMagnitude = Math.min(Math.abs(result.primaryKPI.deltaPercent) / 50, 1);

  // Count corroborating signals: significant stages, critical/warning findings
  const significantStages = result.stageAnalysis.filter((s) => s.isSignificant).length;
  const totalStages = result.stageAnalysis.length;
  const signalDensity = totalStages > 0 ? significantStages / totalStages : 0;

  const criticalFindings = result.findings.filter((f) => f.severity === "critical").length;
  const findingBoost = Math.min(criticalFindings * 0.1, 0.3);

  return Math.min(0.3 + kpiMagnitude * 0.4 + signalDensity * 0.2 + findingBoost, 1);
}

/**
 * Estimate a reasonable budget shift percentage from the KPI delta magnitudes.
 */
function estimateShiftPercent(
  rec: BudgetRecommendation,
  results: Array<PlatformResult & { result: DiagnosticResult }>,
): number {
  const fromResult = results.find((r) => r.platform === rec.from);
  const toResult = results.find((r) => r.platform === rec.to);

  if (!fromResult || !toResult) return 10;

  const fromDelta = Math.abs(fromResult.result.primaryKPI.deltaPercent);
  const toDelta = Math.abs(toResult.result.primaryKPI.deltaPercent);

  // Larger KPI divergence → larger suggested shift, capped at 30%
  return Math.min(Math.round((fromDelta + toDelta) / 4), 30);
}

/**
 * Estimate revenue recovery from a budget reallocation.
 */
function estimateRevenueRecovery(
  rec: BudgetRecommendation,
  results: Array<PlatformResult & { result: DiagnosticResult }>,
): number {
  const toResult = results.find((r) => r.platform === rec.to);
  if (!toResult) return 0;

  // Use elasticity data if available
  if (toResult.result.elasticity) {
    return Math.abs(toResult.result.elasticity.totalEstimatedRevenueLoss) * 0.3;
  }

  return 0;
}

/**
 * Risk level based on budget shift magnitude.
 */
function computeRiskLevel(shiftPercent: number): "low" | "medium" | "high" {
  if (shiftPercent > 30) return "high";
  if (shiftPercent > 10) return "medium";
  return "low";
}
