import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";
import { percentChange } from "../../core/analysis/significance.js";
import {
  analyzeHeadroom,
  type DailyDataPoint,
  type HeadroomResult,
  type HeadroomModelConfig,
  type HeadroomEstimate,
} from "../../core/analysis/headroom.js";

// ---------------------------------------------------------------------------
// Headroom Advisor
// ---------------------------------------------------------------------------
// Uses the Headroom 3.1 response curve engine to estimate how much additional
// spend an account or campaign can absorb before hitting diminishing returns.
//
// Requires dailyBreakdowns in DiagnosticContext (21+ days of daily data).
// Produces findings at multiple severity levels:
//   - healthy: room to scale with high confidence
//   - info: room to scale but with caveats
//   - warning: near capacity or low-confidence model
//   - critical: over-spending (current CPA already above target)
//
// Also integrates creative health gate: if CTR has declined >15% over the
// data period, downgrades recommendation from "Scale" to "Refresh First".
// ---------------------------------------------------------------------------

export interface HeadroomAdvisorOptions {
  /** Target CPA — headroom calculated relative to this */
  targetCPA?: number;
  /** Target ROAS — headroom calculated relative to this */
  targetROAS?: number;
}

export function createHeadroomAdvisor(options?: HeadroomAdvisorOptions): FindingAdvisor {
  return (
    _stageAnalysis: StageDiagnostic[],
    _dropoffs: FunnelDropoff[],
    current: MetricSnapshot,
    previous: MetricSnapshot,
    context?: DiagnosticContext,
  ): Finding[] => {
    const findings: Finding[] = [];

    // Require daily breakdowns
    if (!context?.dailyBreakdowns) {
      return findings;
    }

    // Minimum data check
    if (context.dailyBreakdowns.length < 21) {
      findings.push({
        severity: "info",
        stage: "headroom",
        message:
          "Insufficient daily data for headroom analysis — need at least 21 days of active spend data.",
        recommendation:
          "Ensure campaigns run for 3+ weeks with consistent spend before requesting a headroom analysis.",
      });
      return findings;
    }

    // Build daily data points from breakdowns
    const dailyData: DailyDataPoint[] = context.dailyBreakdowns.map((day) => {
      // Estimate revenue from ROAS data if available
      let revenue: number | null = null;
      if (context.revenueData && context.revenueData.totalRevenue > 0) {
        // Proportionally allocate total revenue by day based on conversions
        const totalConversions = context.dailyBreakdowns!.reduce(
          (sum, d) => sum + d.conversions,
          0,
        );
        if (totalConversions > 0) {
          revenue = (day.conversions / totalConversions) * context.revenueData.totalRevenue;
        }
      }

      // CTR from daily data
      const ctr = day.impressions > 0 ? (day.clicks / day.impressions) * 100 : null;

      return {
        date: day.date,
        spend: day.spend,
        conversions: day.conversions,
        revenue,
        ctr,
      };
    });

    // Run headroom analysis
    const modelConfig: HeadroomModelConfig = {
      targetCPA: options?.targetCPA,
      targetROAS: options?.targetROAS,
    };

    const result = analyzeHeadroom(dailyData, modelConfig);

    if (!result) {
      findings.push({
        severity: "info",
        stage: "headroom",
        message:
          "Headroom analysis could not produce reliable results — too many data points were removed during cleaning (zero-spend days, outliers). Need at least 21 clean days.",
        recommendation:
          "Ensure campaigns run consistently without pauses or extreme spend fluctuations. Re-run after accumulating 3+ weeks of stable spend data.",
      });
      return findings;
    }

    // Creative health gate: check if CTR declined >15% over the period
    const creativeFatigueDetected = checkCreativeHealth(context);

    // Generate findings from headroom result
    findings.push(...buildHeadroomFindings(result, creativeFatigueDetected, current, previous));

    return findings;
  };
}

// ---------------------------------------------------------------------------
// Creative health gate
// ---------------------------------------------------------------------------

/**
 * Check if CTR declined >15% from the first half to second half of the period.
 * This indicates creative fatigue which would make scaling counterproductive.
 */
function checkCreativeHealth(context: DiagnosticContext): boolean {
  if (!context.dailyBreakdowns || context.dailyBreakdowns.length < 14) {
    return false;
  }

  const days = context.dailyBreakdowns;
  const midpoint = Math.floor(days.length / 2);

  const firstHalf = days.slice(0, midpoint);
  const secondHalf = days.slice(midpoint);

  const firstCTR = computeAggregateCTR(firstHalf);
  const secondCTR = computeAggregateCTR(secondHalf);

  if (firstCTR === null || secondCTR === null || firstCTR === 0) return false;

  const ctrChange = percentChange(secondCTR, firstCTR);
  return ctrChange < -15;
}

function computeAggregateCTR(days: Array<{ impressions: number; clicks: number }>): number | null {
  const totalImpressions = days.reduce((sum, d) => sum + d.impressions, 0);
  const totalClicks = days.reduce((sum, d) => sum + d.clicks, 0);
  if (totalImpressions === 0) return null;
  return (totalClicks / totalImpressions) * 100;
}

// ---------------------------------------------------------------------------
// Finding generation
// ---------------------------------------------------------------------------

function buildHeadroomFindings(
  result: HeadroomResult,
  creativeFatigueDetected: boolean,
  current: MetricSnapshot,
  _previous: MetricSnapshot,
): Finding[] {
  const findings: Finding[] = [];
  const { estimate, confidence, confidenceBand, selectedModel, dataQuality: _dataQuality } = result;

  const headroom = estimate.headroomPercent;
  const bandStr = `${confidenceBand.lowerPercent.toFixed(0)}%-${confidenceBand.upperPercent.toFixed(0)}%`;
  const modelLabel =
    selectedModel.modelType === "logarithmic"
      ? "logarithmic regression"
      : `power-law regression (elasticity=${selectedModel.elasticity?.toFixed(2)})`;

  // Creative fatigue gate — override recommendation
  if (creativeFatigueDetected && headroom > 5) {
    findings.push({
      severity: "warning",
      stage: "headroom",
      message: `Headroom model shows ${headroom.toFixed(0)}% scaling potential (${bandStr} confidence band), but CTR has declined >15% over the analysis period. Scaling into fatigued creatives will produce worse results than predicted.`,
      recommendation:
        "Refresh creatives before scaling spend. Introduce 2-3 new creative variations with different hooks and formats. Re-run headroom analysis after creatives have stabilized (7+ days post-refresh).",
    });
    return findings;
  }

  // No headroom
  if (headroom <= 2) {
    const cpaStr =
      estimate.predictedCPA !== null ? ` at CPA $${estimate.predictedCPA.toFixed(2)}` : "";
    findings.push({
      severity: "info",
      stage: "headroom",
      message: `Headroom analysis (${modelLabel}, R²=${selectedModel.rSquared.toFixed(2)}): no meaningful scaling opportunity detected. Current spend ($${estimate.currentDailySpend.toFixed(0)}/day) is near optimal${cpaStr}.`,
      recommendation:
        "This account is operating near its efficient frontier. Focus on improving conversion rates (creative, landing page, offer) rather than increasing spend.",
    });
    appendCaveats(findings, result);
    return findings;
  }

  // Determine severity based on confidence and headroom
  if (confidence === "high" && headroom > 10) {
    const cpaInfo =
      estimate.predictedCPA !== null
        ? ` Predicted CPA at recommended spend: $${estimate.predictedCPA.toFixed(2)}.`
        : "";
    const roasInfo =
      estimate.predictedROAS !== null
        ? ` Predicted ROAS: ${estimate.predictedROAS.toFixed(2)}x.`
        : "";
    const elasticityInfo =
      selectedModel.elasticity !== null
        ? ` Spend elasticity: ${selectedModel.elasticity.toFixed(2)} (10% more spend → ${(selectedModel.elasticity * 10).toFixed(1)}% more conversions).`
        : "";

    findings.push({
      severity: "healthy",
      stage: "headroom",
      message: `High-confidence headroom detected: ${headroom.toFixed(0)}% scaling opportunity (${bandStr} confidence band). Recommended daily spend: $${estimate.recommendedDailySpend.toFixed(0)} (from $${estimate.currentDailySpend.toFixed(0)}).${cpaInfo}${roasInfo}${elasticityInfo} Model: ${modelLabel}, R²=${selectedModel.rSquared.toFixed(2)}.`,
      recommendation: buildScalingRecommendation(estimate, current.spend),
    });
  } else if (confidence === "medium" || (confidence === "high" && headroom <= 10)) {
    findings.push({
      severity: "info",
      stage: "headroom",
      message: `Moderate headroom detected: ${headroom.toFixed(0)}% potential scaling (${bandStr} confidence band). Recommended daily spend: $${estimate.recommendedDailySpend.toFixed(0)}. Model: ${modelLabel}, R²=${selectedModel.rSquared.toFixed(2)}.`,
      recommendation:
        `Consider a gradual ${Math.min(headroom, 20).toFixed(0)}% budget increase as a test. ` +
        `Monitor CPA/ROAS for 5-7 days after scaling. ` +
        `If results match predictions, increase further toward the ${headroom.toFixed(0)}% target.`,
    });
  } else {
    // Low confidence
    findings.push({
      severity: "warning",
      stage: "headroom",
      message: `Headroom model suggests ${headroom.toFixed(0)}% scaling potential, but model confidence is low (R²=${selectedModel.rSquared.toFixed(2)}). The spend-conversion relationship is weak — predictions are unreliable.`,
      recommendation:
        "Do not scale based on this analysis. Run a controlled budget test (increase spend 15-20% for 2 weeks) to generate better data, then re-run the analysis. Low R² often indicates external factors (creative changes, audience shifts, seasonality) are dominating performance.",
    });
  }

  appendCaveats(findings, result);

  // Multi-goal visibility: if we have both CPA and ROAS predictions, note the trade-off
  if (estimate.predictedCPA !== null && estimate.predictedROAS !== null) {
    findings.push({
      severity: "info",
      stage: "headroom",
      message: `At recommended spend: CPA=$${estimate.predictedCPA.toFixed(2)}, ROAS=${estimate.predictedROAS.toFixed(2)}x, volume=${estimate.predictedConversions.toFixed(0)} conversions/day. Review all three metrics to find the right balance for your goals.`,
      recommendation: null,
    });
  }

  return findings;
}

function buildScalingRecommendation(
  estimate: HeadroomEstimate,
  currentPeriodSpend: number,
): string {
  const increasePercent = estimate.headroomPercent;
  const stepSize = Math.min(increasePercent, 20);

  return (
    `Scale budget in ${stepSize.toFixed(0)}% increments every 3-5 days to avoid learning phase resets. ` +
    `Target: $${estimate.recommendedDailySpend.toFixed(0)}/day (from $${estimate.currentDailySpend.toFixed(0)}/day). ` +
    `Monitor marginal CPA — if it exceeds 2x blended CPA at any step, pause the increase. ` +
    `Expected additional conversions: ~${Math.max(0, estimate.predictedConversions - (currentPeriodSpend > 0 ? estimate.currentDailySpend / (currentPeriodSpend / estimate.predictedConversions) : 0)).toFixed(0)}/day.`
  );
}

function appendCaveats(findings: Finding[], result: HeadroomResult): void {
  if (result.caveats.length > 0) {
    findings.push({
      severity: "info",
      stage: "headroom",
      message: `Headroom caveats: ${result.caveats.join(" | ")}`,
      recommendation: null,
    });
  }
}

/** Default headroom advisor (no target CPA/ROAS) */
export const headroomAdvisor: FindingAdvisor = createHeadroomAdvisor();
