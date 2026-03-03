import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Creative Exhaustion Advisor (predictive — trend-based)
// ---------------------------------------------------------------------------
// Unlike the reactive creative-fatigue advisor (which detects a single-period
// CTR drop), this advisor looks at multi-period CTR trends to predict
// creative exhaustion before it becomes critical.
//
// Requires historical snapshots in DiagnosticContext (minimum 3 periods).
// Triggers on 3+ consecutive periods of CTR decline, even if no single
// period exceeds the 15% threshold.
// ---------------------------------------------------------------------------

/**
 * Predictive creative exhaustion advisor.
 *
 * Examines CTR across multiple trailing periods to detect sustained
 * engagement decay. This catches gradual creative exhaustion that
 * wouldn't trigger the single-period creative fatigue advisor.
 */
export const creativeExhaustionAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext,
): Finding[] => {
  if (!context?.historicalSnapshots || context.historicalSnapshots.length < 3) {
    return [];
  }

  const findings: Finding[] = [];

  // Build CTR timeline: current period + historical snapshots (most recent first)
  const ctrTimeline: number[] = [];

  const currentCTR = current.topLevel.ctr ?? 0;
  if (currentCTR > 0) {
    ctrTimeline.push(currentCTR);
  }

  for (const snapshot of context.historicalSnapshots) {
    const ctr = snapshot.topLevel.ctr ?? 0;
    if (ctr > 0) {
      ctrTimeline.push(ctr);
    }
  }

  // Need at least 4 data points (current + 3 historical) for trend analysis
  if (ctrTimeline.length < 4) {
    return findings;
  }

  // Check for consecutive CTR declines (most recent to oldest)
  let consecutiveDeclines = 0;
  let totalDeclinePercent = 0;
  const declineRates: number[] = [];

  for (let i = 0; i < ctrTimeline.length - 1; i++) {
    const newer = ctrTimeline[i]!;
    const older = ctrTimeline[i + 1]!;

    if (older > 0 && newer < older) {
      consecutiveDeclines++;
      const declineRate = ((newer - older) / older) * 100;
      totalDeclinePercent += declineRate;
      declineRates.push(declineRate);
    } else {
      break; // Stop at first non-decline
    }
  }

  if (consecutiveDeclines >= 3) {
    // Check if decline is accelerating
    const isAccelerating =
      declineRates.length >= 2 && Math.abs(declineRates[0]!) > Math.abs(declineRates[1]!);

    const severity = isAccelerating ? "critical" : "warning";
    const avgDecline = totalDeclinePercent / consecutiveDeclines;

    const oldestCTR = ctrTimeline[consecutiveDeclines]!;
    const cumulativeDecline =
      oldestCTR > 0 ? (((currentCTR - oldestCTR) / oldestCTR) * 100).toFixed(1) : "N/A";

    findings.push({
      severity,
      stage: "click",
      message:
        `Creative exhaustion detected: CTR has declined for ${consecutiveDeclines} consecutive periods (avg ${avgDecline.toFixed(1)}%/period, cumulative ${cumulativeDecline}%). ${isAccelerating ? "The decline is accelerating." : ""}`.trim(),
      recommendation: isAccelerating
        ? "Creative refresh is urgent — the decline is accelerating. Prepare new creative variations immediately and consider pausing the worst-performing ads to stop audience fatigue from worsening."
        : "Creative is showing sustained fatigue. Begin testing new creative angles, formats, or hooks. Rotate in fresh variations over the next 1-2 weeks to prevent further erosion.",
    });
  }

  return findings;
};
