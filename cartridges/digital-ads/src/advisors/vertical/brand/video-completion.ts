import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";
import { percentChange } from "../../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Video Completion Advisor (Brand Vertical)
// ---------------------------------------------------------------------------
// Tracks ThruPlay / video completion rate trends for brand campaigns.
// Video completion rate (VCR) is the primary engagement signal for brand
// video campaigns — declining VCR means the creative is losing audience
// attention, which directly impacts brand recall and awareness lift.
//
// Data: ThruPlay (Meta), video_views (Google), video_views_p50 (TikTok)
// stored in topLevel by the platform clients.
// ---------------------------------------------------------------------------

export const videoCompletionAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  _context?: DiagnosticContext
): Finding[] => {
  const findings: Finding[] = [];

  // Extract video views from various platform-specific keys
  const currentVideoViews =
    current.topLevel.video_thruplay_actions ??
    current.topLevel.video_views ??
    current.topLevel.video_views_p50 ??
    0;

  const previousVideoViews =
    previous.topLevel.video_thruplay_actions ??
    previous.topLevel.video_views ??
    previous.topLevel.video_views_p50 ??
    0;

  const currentImpressions = current.topLevel.impressions ?? 0;
  const previousImpressions = previous.topLevel.impressions ?? 0;

  // Need video data in both periods
  if (currentVideoViews === 0 && previousVideoViews === 0) return findings;

  // Compute video completion rates
  const currentVCR =
    currentImpressions > 0 ? (currentVideoViews / currentImpressions) * 100 : 0;
  const previousVCR =
    previousImpressions > 0 ? (previousVideoViews / previousImpressions) * 100 : 0;

  if (previousVCR === 0) return findings;

  const vcrChange = percentChange(currentVCR, previousVCR);

  // Also check cost per video view
  const currentCPV = currentVideoViews > 0 ? current.spend / currentVideoViews : 0;
  const previousCPV = previousVideoViews > 0 ? previous.spend / previousVideoViews : 0;
  const cpvChange = previousCPV > 0 ? percentChange(currentCPV, previousCPV) : 0;

  // VCR declining significantly
  if (vcrChange < -15) {
    findings.push({
      severity: vcrChange < -30 ? "critical" : "warning",
      stage: "video_completion",
      message: `Video completion rate declined ${vcrChange.toFixed(1)}% WoW (${previousVCR.toFixed(1)}% → ${currentVCR.toFixed(1)}%). ${cpvChange > 10 ? `Cost per view also increased ${cpvChange.toFixed(1)}%.` : ""}`,
      recommendation:
        vcrChange < -30
          ? "Video creative is losing audience attention rapidly. Test new creative with different hooks in the first 3 seconds. Consider shorter ad formats or different storytelling approaches. Review audience targeting — the content may not resonate with the current audience."
          : "Video engagement is declining. Refresh creative with new hooks, test different video lengths, or try different content angles. Monitor if this is a creative fatigue issue or an audience mismatch.",
    });
  }

  // VCR improving
  if (vcrChange > 15 && currentVCR > 0) {
    findings.push({
      severity: "healthy",
      stage: "video_completion",
      message: `Video completion rate improved ${vcrChange.toFixed(1)}% WoW (${previousVCR.toFixed(1)}% → ${currentVCR.toFixed(1)}%).${cpvChange < -5 ? ` Cost per view decreased ${Math.abs(cpvChange).toFixed(1)}%.` : ""}`,
      recommendation: null,
    });
  }

  // Low absolute VCR
  if (currentVCR > 0 && currentVCR < 10) {
    findings.push({
      severity: "info",
      stage: "video_completion",
      message: `Video completion rate is low at ${currentVCR.toFixed(1)}%. Most brand video benchmarks target 15-30% completion rates.`,
      recommendation:
        "Low completion rates suggest the creative isn't holding attention. Test shorter videos (6-15 seconds), use stronger hooks in the first 3 seconds, and ensure the brand message is delivered early rather than at the end.",
    });
  }

  return findings;
};
