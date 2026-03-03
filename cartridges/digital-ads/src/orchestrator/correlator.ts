import type { DiagnosticResult } from "../core/types.js";
import type { PlatformType } from "../platforms/types.js";
import type { CrossPlatformFinding, BudgetRecommendation, PlatformResult } from "./types.js";
import { getActiveSeasonalEvent } from "../core/analysis/seasonality.js";

// ---------------------------------------------------------------------------
// Cross-Platform Correlator
// ---------------------------------------------------------------------------
// Analyzes results from multiple platforms to detect patterns that only
// emerge when you look across the full media portfolio.
// ---------------------------------------------------------------------------

export interface CorrelationResult {
  findings: CrossPlatformFinding[];
  budgetRecommendations: BudgetRecommendation[];
}

export function correlate(platformResults: PlatformResult[]): CorrelationResult {
  const successfulResults = platformResults.filter(
    (r): r is PlatformResult & { result: DiagnosticResult } =>
      r.status === "success" && r.result !== undefined,
  );

  if (successfulResults.length < 2) {
    return { findings: [], budgetRecommendations: [] };
  }

  const findings: CrossPlatformFinding[] = [];
  const budgetRecommendations: BudgetRecommendation[] = [];

  // Detect market-wide signals
  findings.push(...detectMarketWideSignals(successfulResults));

  // Detect halo effects
  findings.push(...detectHaloEffects(successfulResults));

  // Detect platform conflicts and generate budget recommendations
  const conflictResult = detectPlatformConflicts(successfulResults);
  findings.push(...conflictResult.findings);
  budgetRecommendations.push(...conflictResult.budgetRecommendations);

  return { findings, budgetRecommendations };
}

// ---------------------------------------------------------------------------
// Market-wide signal detection
// ---------------------------------------------------------------------------
// When all platforms show CPM increases, it's a market-level issue
// (seasonal competition, macro event) rather than an account-specific problem.

function detectMarketWideSignals(
  results: Array<PlatformResult & { result: DiagnosticResult }>,
): CrossPlatformFinding[] {
  const findings: CrossPlatformFinding[] = [];

  // Check if CPMs are up across all platforms
  const cpmChanges: Array<{ platform: PlatformType; change: number }> = [];

  for (const pr of results) {
    const impressionsStage = pr.result.stageAnalysis.find((s) => s.stageName === "awareness");

    // Use spend and impressions to compute CPM change
    const currentSpend = pr.result.spend.current;
    const previousSpend = pr.result.spend.previous;
    const currentImpressions = impressionsStage?.currentValue ?? 0;
    const previousImpressions = impressionsStage?.previousValue ?? 0;

    if (currentImpressions > 0 && previousImpressions > 0) {
      const currentCPM = (currentSpend / currentImpressions) * 1000;
      const previousCPM = (previousSpend / previousImpressions) * 1000;
      if (previousCPM > 0) {
        const change = ((currentCPM - previousCPM) / previousCPM) * 100;
        cpmChanges.push({ platform: pr.platform, change });
      }
    }
  }

  // If all platforms have CPM increases > 15%, it's market-wide
  if (cpmChanges.length >= 2 && cpmChanges.every((c) => c.change > 15)) {
    const avgChange = cpmChanges.reduce((sum, c) => sum + c.change, 0) / cpmChanges.length;

    // Check for seasonal events that would explain CPM increases
    const periodStart = results[0]!.result.periods.current.since;
    const periodEnd = results[0]!.result.periods.current.until;
    const seasonalEvent = getActiveSeasonalEvent(periodStart, periodEnd);

    // Adjust threshold by seasonal multiplier
    const effectiveThreshold = seasonalEvent ? 15 * seasonalEvent.cpmThresholdMultiplier : 15;

    // If the CPM increase is within seasonal norms, suppress or downgrade
    if (seasonalEvent && avgChange <= effectiveThreshold) {
      findings.push({
        signal: "market_wide_cpm_increase",
        severity: "info",
        platforms: cpmChanges.map((c) => c.platform),
        message: `CPMs increased across all platforms (avg +${avgChange.toFixed(1)}%) during ${seasonalEvent.name}. This is within expected seasonal ranges.`,
        recommendation: `CPM increases during ${seasonalEvent.name} are normal due to heightened advertiser competition. Maintain current strategy unless increases significantly exceed seasonal norms. Focus on conversion rate optimization rather than fighting auction costs.`,
        confidenceScore: Math.min(avgChange / 60, 1),
        riskLevel: "low",
      });
    } else {
      findings.push({
        signal: "market_wide_cpm_increase",
        severity: avgChange > 40 ? "critical" : "warning",
        platforms: cpmChanges.map((c) => c.platform),
        message: seasonalEvent
          ? `CPMs increased across all platforms (avg +${avgChange.toFixed(1)}%) during ${seasonalEvent.name}, exceeding expected seasonal ranges.`
          : `CPMs increased across all platforms (avg +${avgChange.toFixed(1)}%). This suggests market-wide competition rather than an account-specific issue.`,
        recommendation:
          "Market-wide CPM increases are typically seasonal (Q4, BFCM) or driven by macro events. Consider temporarily reducing spend until costs normalize, or shift budget to lower-CPM placements/channels that may not be as affected.",
        confidenceScore: Math.min(avgChange / 60, 1),
        riskLevel: avgChange > 40 ? "high" : "medium",
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Halo effect detection
// ---------------------------------------------------------------------------
// When one platform's awareness spend increases and another platform's
// conversions improve, it suggests a halo/cross-platform attribution effect.

function detectHaloEffects(
  results: Array<PlatformResult & { result: DiagnosticResult }>,
): CrossPlatformFinding[] {
  const findings: CrossPlatformFinding[] = [];

  for (let i = 0; i < results.length; i++) {
    for (let j = 0; j < results.length; j++) {
      if (i === j) continue;

      const awarenessResult = results[i]!;
      const conversionResult = results[j]!;

      // Check if platform i had increased awareness spend
      const spendChange =
        awarenessResult.result.spend.previous > 0
          ? ((awarenessResult.result.spend.current - awarenessResult.result.spend.previous) /
              awarenessResult.result.spend.previous) *
            100
          : 0;

      // Check if platform j had improved KPI
      const kpiDelta = conversionResult.result.primaryKPI.deltaPercent;

      // Halo pattern: awareness platform spend up >20%, conversion platform KPI improved (cost down)
      if (spendChange > 20 && kpiDelta < -10) {
        findings.push({
          signal: "halo_effect",
          severity: "info",
          platforms: [awarenessResult.platform, conversionResult.platform],
          message: `${awarenessResult.platform} spend increased ${spendChange.toFixed(1)}% and ${conversionResult.platform} conversion costs improved ${kpiDelta.toFixed(1)}%. This may indicate a cross-platform halo effect where ${awarenessResult.platform} awareness is driving ${conversionResult.platform} conversions.`,
          recommendation: `Consider ${awarenessResult.platform} as an awareness driver rather than evaluating it purely on direct CPA. Cross-platform attribution tools can help quantify this lift. Be cautious about cutting ${awarenessResult.platform} spend without monitoring the downstream impact on ${conversionResult.platform}.`,
          confidenceScore: Math.min((spendChange * Math.abs(kpiDelta)) / 2000, 0.8),
          riskLevel: "low",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Platform conflict detection
// ---------------------------------------------------------------------------
// When one platform's KPI is improving while another's is worsening,
// there may be a budget reallocation opportunity.

function detectPlatformConflicts(results: Array<PlatformResult & { result: DiagnosticResult }>): {
  findings: CrossPlatformFinding[];
  budgetRecommendations: BudgetRecommendation[];
} {
  const findings: CrossPlatformFinding[] = [];
  const budgetRecommendations: BudgetRecommendation[] = [];

  // Find platforms where KPI is improving (cost decreasing) vs worsening
  const improving: Array<PlatformResult & { result: DiagnosticResult }> = [];
  const worsening: Array<PlatformResult & { result: DiagnosticResult }> = [];

  for (const pr of results) {
    const kpiDelta = pr.result.primaryKPI.deltaPercent;
    // For cost metrics, negative delta = improving (costs going down)
    if (kpiDelta < -10) {
      improving.push(pr);
    } else if (kpiDelta > 15) {
      worsening.push(pr);
    }
  }

  if (improving.length > 0 && worsening.length > 0) {
    const improvingNames = improving.map((p) => p.platform).join(", ");
    const worseningNames = worsening.map((p) => p.platform).join(", ");

    findings.push({
      signal: "platform_conflict",
      severity: "warning",
      platforms: [...improving, ...worsening].map((p) => p.platform),
      message: `Performance is diverging across platforms: ${improvingNames} KPI improving while ${worseningNames} KPI worsening. This suggests a budget reallocation opportunity.`,
      recommendation:
        "Consider shifting incremental budget from underperforming platforms to those showing improving efficiency. Run this diagnostic again after reallocation to verify the trend holds.",
      confidenceScore: Math.min(
        (improving.reduce((sum, p) => sum + Math.abs(p.result.primaryKPI.deltaPercent), 0) +
          worsening.reduce((sum, p) => sum + Math.abs(p.result.primaryKPI.deltaPercent), 0)) /
          100,
        0.9,
      ),
      riskLevel: "medium",
    });

    // Generate specific budget recommendations
    for (const worse of worsening) {
      for (const better of improving) {
        const shiftPercent = Math.min(
          Math.round(
            (Math.abs(worse.result.primaryKPI.deltaPercent) +
              Math.abs(better.result.primaryKPI.deltaPercent)) /
              4,
          ),
          30,
        );
        const confidence =
          Math.abs(worse.result.primaryKPI.deltaPercent) > 30 &&
          Math.abs(better.result.primaryKPI.deltaPercent) > 20
            ? ("high" as const)
            : ("medium" as const);

        budgetRecommendations.push({
          from: worse.platform,
          to: better.platform,
          reason: `${worse.platform} CPA worsened ${worse.result.primaryKPI.deltaPercent.toFixed(1)}% while ${better.platform} CPA improved ${better.result.primaryKPI.deltaPercent.toFixed(1)}%`,
          confidence,
          suggestedShiftPercent: shiftPercent,
          estimatedKPIImprovement: Math.abs(better.result.primaryKPI.deltaPercent) * 0.5,
          riskLevel: shiftPercent > 30 ? "high" : shiftPercent > 10 ? "medium" : "low",
        });
      }
    }
  }

  return { findings, budgetRecommendations };
}
