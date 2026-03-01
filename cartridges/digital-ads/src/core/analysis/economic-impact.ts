import type {
  StageDiagnostic,
  FunnelDropoff,
  EconomicImpact,
  DiagnosticResult,
  Severity,
} from "../types.js";

// ---------------------------------------------------------------------------
// Economic Impact — dollar-denominated funnel elasticity scoring
// ---------------------------------------------------------------------------
// Pure functions that convert percentage-based stage deltas into estimated
// revenue impact. This lets the diagnostic engine rank bottlenecks by
// financial severity rather than raw percentages.
// ---------------------------------------------------------------------------

/**
 * Compute the estimated revenue impact of a stage's WoW change.
 *
 * For bottom-of-funnel stages (purchases, conversions), the impact is direct:
 *   revenue delta = conversion delta × AOV
 *
 * For upper-funnel stages, the impact is attenuated because not every
 * lost impression/click would have converted. We use a conservative
 * multiplier (0.1 for awareness, 0.3 for mid-funnel) to avoid overstating.
 */
export function computeStageEconomicImpact(
  stage: StageDiagnostic,
  averageOrderValue: number,
  isBottomOfFunnel: boolean
): EconomicImpact {
  const conversionDelta = stage.currentValue - stage.previousValue;

  let estimatedRevenueDelta: number;
  if (isBottomOfFunnel) {
    // Direct impact: each lost conversion = lost AOV
    estimatedRevenueDelta = conversionDelta * averageOrderValue;
  } else {
    // Upper-funnel: attenuated impact
    // Use a conservative multiplier based on typical funnel position
    const funnelMultiplier = stage.metric === "impressions" ? 0.01 : 0.1;
    estimatedRevenueDelta = conversionDelta * averageOrderValue * funnelMultiplier;
  }

  const previousRevenue = stage.previousValue * averageOrderValue * (isBottomOfFunnel ? 1 : 0.1);
  const revenueImpactPercent =
    previousRevenue !== 0
      ? (estimatedRevenueDelta / Math.abs(previousRevenue)) * 100
      : 0;

  return {
    estimatedRevenueDelta,
    conversionDelta,
    revenueImpactPercent,
  };
}

/**
 * Compute the economic impact of a drop-off rate change between two stages.
 *
 * Uses the expected conversion count from the previous period and the
 * drop-off rate delta to estimate how many conversions were lost at
 * this funnel transition.
 */
export function computeDropoffEconomicImpact(
  dropoff: FunnelDropoff,
  expectedConversions: number,
  averageOrderValue: number
): EconomicImpact {
  // The rate delta tells us what fraction of flow was lost at this transition
  const rateDelta = dropoff.currentRate - dropoff.previousRate;
  const conversionDelta = rateDelta * expectedConversions;
  const estimatedRevenueDelta = conversionDelta * averageOrderValue;

  const previousRevenue = expectedConversions * averageOrderValue;
  const revenueImpactPercent =
    previousRevenue !== 0
      ? (estimatedRevenueDelta / Math.abs(previousRevenue)) * 100
      : 0;

  return {
    estimatedRevenueDelta,
    conversionDelta,
    revenueImpactPercent,
  };
}

/**
 * Build a ranked list of stages sorted by absolute revenue impact (worst first).
 * Only includes stages with negative revenue impact (losses).
 */
export function buildElasticityRanking(
  stageAnalysis: StageDiagnostic[]
): NonNullable<DiagnosticResult["elasticity"]> {
  const losses = stageAnalysis
    .filter(
      (s) =>
        s.economicImpact &&
        s.economicImpact.estimatedRevenueDelta < 0 &&
        s.isSignificant
    )
    .sort(
      (a, b) =>
        (a.economicImpact?.estimatedRevenueDelta ?? 0) -
        (b.economicImpact?.estimatedRevenueDelta ?? 0)
    );

  const impactRanking: Array<{
    stage: string;
    estimatedRevenueDelta: number;
    severity: Severity;
  }> = losses.map((s) => ({
    stage: s.stageName,
    estimatedRevenueDelta: s.economicImpact!.estimatedRevenueDelta,
    severity: s.severity,
  }));

  const totalEstimatedRevenueLoss = impactRanking.reduce(
    (sum, entry) => sum + entry.estimatedRevenueDelta,
    0
  );

  return { totalEstimatedRevenueLoss, impactRanking };
}
