import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Placement Efficiency Advisor
// ---------------------------------------------------------------------------
// Flags placements with disproportionate spend but poor conversion rates.
// On Meta alone: Feed, Stories, Reels, Right Column, Audience Network each
// have vastly different CPMs and conversion rates.
//
// Data: PlacementBreakdown[] from DiagnosticContext (populated by platform
// clients when placement breakdowns are enabled).
// ---------------------------------------------------------------------------

export const placementEfficiencyAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext
): Finding[] => {
  if (!context?.placementBreakdowns || context.placementBreakdowns.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  const placements = context.placementBreakdowns;

  const totalSpend = placements.reduce((sum, p) => sum + p.spend, 0);
  const totalConversions = placements.reduce((sum, p) => sum + p.conversions, 0);

  if (totalSpend === 0 || totalConversions === 0) return findings;

  const avgCPA = totalSpend / totalConversions;
  const wastefulPlacements: string[] = [];
  let wastefulSpend = 0;

  for (const placement of placements) {
    const spendShare = placement.spend / totalSpend;
    const placementCPA = placement.conversions > 0
      ? placement.spend / placement.conversions
      : Infinity;

    // Flag: >10% of spend but CPA >2x average
    if (spendShare > 0.1 && placementCPA > avgCPA * 2) {
      wastefulPlacements.push(placement.placement);
      wastefulSpend += placement.spend;
    }

    // Flag: significant spend with zero conversions
    if (spendShare > 0.05 && placement.conversions === 0) {
      findings.push({
        severity: spendShare > 0.15 ? "critical" : "warning",
        stage: "placement",
        message: `Placement "${placement.placement}" has $${placement.spend.toFixed(2)} spend (${(spendShare * 100).toFixed(1)}% of total) with zero conversions.`,
        recommendation:
          `Consider excluding "${placement.placement}" or significantly reducing its allocation. Zero-conversion placements are burning budget without contributing to your KPI.`,
      });
    }
  }

  if (wastefulPlacements.length > 0) {
    findings.push({
      severity: wastefulSpend / totalSpend > 0.25 ? "critical" : "warning",
      stage: "placement",
      message: `Inefficient placements detected: ${wastefulPlacements.join(", ")} have CPA more than 2x the account average ($${avgCPA.toFixed(2)}), consuming $${wastefulSpend.toFixed(2)} (${((wastefulSpend / totalSpend) * 100).toFixed(1)}% of spend).`,
      recommendation:
        "Exclude or reduce budget to underperforming placements. On Meta, use placement-level asset customization to create format-appropriate creative rather than blanket exclusions. On Google, consider separate campaigns for different network types.",
    });
  }

  return findings;
};
