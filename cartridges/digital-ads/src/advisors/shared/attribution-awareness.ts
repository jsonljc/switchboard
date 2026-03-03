import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Attribution Setting Awareness Advisor
// ---------------------------------------------------------------------------
// Pre-check that warns when attribution windows changed between the
// current and previous comparison periods, which invalidates WoW
// comparisons.
//
// Attribution window changes can cause massive apparent swings:
// - Switching from 28-day click to 7-day click removes 60-70% of
//   attributed conversions
// - Adding view-through attribution can double reported conversions
// - Changing from last-click to data-driven can redistribute credit
//
// These appear as huge CPA/conversion changes but are measurement
// artifacts, not actual performance changes.
//
// Data: attributionWindow and previousAttributionWindow from
// DiagnosticContext (populated by platform clients when metadata
// is available).
// ---------------------------------------------------------------------------

export const attributionAwarenessAdvisor: FindingAdvisor = (
  stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  context?: DiagnosticContext,
): Finding[] => {
  // Check for explicit attribution window metadata
  if (
    context?.attributionWindow !== undefined &&
    context?.previousAttributionWindow !== undefined
  ) {
    return analyzeExplicitWindowChange(
      context.attributionWindow,
      context.previousAttributionWindow,
      stageAnalysis,
    );
  }

  // Heuristic: detect likely attribution window change from metric patterns
  return analyzeHeuristicWindowChange(stageAnalysis, current, previous);
};

// ---------------------------------------------------------------------------
// Explicit attribution window analysis
// ---------------------------------------------------------------------------

function analyzeExplicitWindowChange(
  currentWindow: number,
  previousWindow: number,
  stageAnalysis: StageDiagnostic[],
): Finding[] {
  const findings: Finding[] = [];

  if (currentWindow === previousWindow) return findings;

  const windowChange = currentWindow > previousWindow ? "widened" : "narrowed";
  const expectedImpact =
    currentWindow > previousWindow
      ? "increase in reported conversions (more attribution credit captured)"
      : "decrease in reported conversions (less attribution credit captured)";

  // Check if stage changes align with the window change
  const hasLargeChange = stageAnalysis.some(
    (s) => Math.abs(s.deltaPercent) > 20 && s.isSignificant,
  );

  findings.push({
    severity: hasLargeChange ? "critical" : "warning",
    stage: "attribution",
    message: `Attribution window changed from ${previousWindow}-day to ${currentWindow}-day between comparison periods. This ${windowChange} window is expected to cause an ${expectedImpact}. WoW comparison is unreliable.`,
    recommendation:
      "Attribution window changes invalidate period-over-period comparisons. The apparent performance shift is a measurement artifact, not an actual change. Compare this period against a period with the same attribution window, or wait until both periods use the same setting before drawing conclusions.",
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Heuristic attribution window change detection
// ---------------------------------------------------------------------------
// When we don't have explicit metadata, detect the pattern:
// 1. Very large conversion volume change (>40%) without corresponding
//    spend change suggests measurement change rather than performance change
// 2. All downstream stages shift by similar magnitude while top-of-funnel
//    (impressions, clicks) remain stable

function analyzeHeuristicWindowChange(
  stageAnalysis: StageDiagnostic[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
): Finding[] {
  const findings: Finding[] = [];

  // Require at least 3 stages to detect the pattern
  if (stageAnalysis.length < 3) return findings;

  const spendChange =
    previous.spend > 0 ? ((current.spend - previous.spend) / previous.spend) * 100 : 0;

  // Find top-of-funnel (awareness) and conversion stages
  const topStage = stageAnalysis[0]; // impressions
  const bottomStages = stageAnalysis.slice(-2); // bottom-of-funnel stages

  if (!topStage || bottomStages.length < 2) return findings;

  // Pattern: top-of-funnel stable (<15% change), spend stable (<20% change),
  // but conversion stages all shift dramatically (>40%) in the same direction
  const topStable = Math.abs(topStage.deltaPercent) < 15;
  const spendStable = Math.abs(spendChange) < 20;
  const bottomShiftingUp = bottomStages.every((s) => s.deltaPercent > 40);
  const bottomShiftingDown = bottomStages.every((s) => s.deltaPercent < -40);

  if (topStable && spendStable && (bottomShiftingUp || bottomShiftingDown)) {
    const direction = bottomShiftingUp ? "increased" : "decreased";
    const avgBottomChange =
      bottomStages.reduce((sum, s) => sum + s.deltaPercent, 0) / bottomStages.length;

    findings.push({
      severity: "warning",
      stage: "attribution",
      message: `Possible attribution window change: conversion stages ${direction} by avg ${Math.abs(avgBottomChange).toFixed(1)}% while impressions and spend remained stable. This pattern suggests a measurement change rather than actual performance change.`,
      recommendation:
        "Verify that the attribution window, conversion event definitions, and tracking setup haven't changed between periods. If attribution settings changed, disregard this period's WoW comparison and use a consistent attribution window for reliable trending. Check platform settings and any recent pixel/tag changes.",
    });
  }

  return findings;
}
