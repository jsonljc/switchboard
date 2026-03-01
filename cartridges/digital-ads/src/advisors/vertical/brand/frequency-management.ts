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
// Frequency Management Advisor (Brand Vertical)
// ---------------------------------------------------------------------------
// Brand campaigns need careful frequency management:
// - Too low (<1.5): not enough exposure for message retention
// - Optimal (1.5-4): healthy brand exposure range
// - High (4-7): diminishing returns, ad blindness risk
// - Too high (>7): negative brand sentiment, wasted spend
//
// Different from the audience saturation advisor (shared) which focuses on
// performance fatigue. This advisor focuses on brand health metrics.
// ---------------------------------------------------------------------------

export const frequencyManagementAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  _context?: DiagnosticContext
): Finding[] => {
  const findings: Finding[] = [];

  const currentFrequency = current.topLevel.frequency ?? 0;
  const previousFrequency = previous.topLevel.frequency ?? 0;

  // Need frequency data
  if (currentFrequency === 0) return findings;

  const frequencyChange =
    previousFrequency > 0
      ? percentChange(currentFrequency, previousFrequency)
      : 0;

  // Too high: frequency > 7 — ad blindness and potential negative sentiment
  if (currentFrequency > 7) {
    findings.push({
      severity: "critical",
      stage: "frequency",
      message: `Frequency is critically high at ${currentFrequency.toFixed(1)} (${frequencyChange > 0 ? "+" : ""}${frequencyChange.toFixed(1)}% WoW). At this level, users see the ad 7+ times per week, leading to ad blindness and potential negative brand sentiment.`,
      recommendation:
        "Immediately implement frequency caps (2-3 per week for brand campaigns) or pause and relaunch with fresh targeting. Consider shifting budget to new audience segments or a different platform to reach unique users instead.",
    });
    return findings;
  }

  // High: frequency 4-7 — diminishing returns
  if (currentFrequency > 4) {
    findings.push({
      severity: "warning",
      stage: "frequency",
      message: `Frequency is elevated at ${currentFrequency.toFixed(1)}. Research shows brand recall diminishes significantly above 4 exposures per week, with each additional exposure producing less incremental lift.`,
      recommendation:
        "Set frequency caps at 3-4 per week. Rotate creative to maintain engagement at higher frequencies. Consider expanding audience targeting to spread impressions across more unique users.",
    });
    return findings;
  }

  // Too low: frequency < 1.5 — insufficient exposure
  if (currentFrequency < 1.5 && currentFrequency > 0) {
    findings.push({
      severity: "info",
      stage: "frequency",
      message: `Frequency is low at ${currentFrequency.toFixed(1)}. Brand campaigns typically need 1.5-4 exposures per week for effective message retention. Users may not be seeing the ad enough to build brand awareness.`,
      recommendation:
        "Consider narrowing targeting to concentrate impressions on a core audience, or increase budget to achieve higher frequency within the current audience. Quality of exposure matters more than breadth at low frequency.",
    });
    return findings;
  }

  // Optimal range with stable or rising frequency
  if (currentFrequency >= 1.5 && currentFrequency <= 4) {
    findings.push({
      severity: "healthy",
      stage: "frequency",
      message: `Frequency is in the optimal brand range at ${currentFrequency.toFixed(1)} (target: 1.5-4 per week).`,
      recommendation: null,
    });
  }

  return findings;
};
