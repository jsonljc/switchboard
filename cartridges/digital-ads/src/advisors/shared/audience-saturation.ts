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
// Audience Saturation / Frequency Advisor
// ---------------------------------------------------------------------------
// Creative fatigue detects the symptom (CTR drop) but not the cause
// (high frequency). At frequency 3+ you rotate creative; at frequency 6+
// you need new audiences entirely. Recommendations differ completely.
//
// Data: frequency from Meta (ad-level frequency field), Google
// (average_frequency_rate), TikTok (frequency in report metrics).
// Stored in topLevel.frequency by each platform client.
// ---------------------------------------------------------------------------

export const audienceSaturationAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  _context?: DiagnosticContext
): Finding[] => {
  const findings: Finding[] = [];

  const currentFrequency = current.topLevel.frequency ?? 0;
  const previousFrequency = previous.topLevel.frequency ?? 0;

  // No frequency data available — skip
  if (currentFrequency === 0 && previousFrequency === 0) return findings;

  const currentCTR = current.topLevel.ctr ?? 0;
  const previousCTR = previous.topLevel.ctr ?? 0;

  const ctrChange =
    previousCTR > 0 ? percentChange(currentCTR, previousCTR) : 0;
  const frequencyChange =
    previousFrequency > 0
      ? percentChange(currentFrequency, previousFrequency)
      : 0;

  // Tier 1: Critical audience exhaustion — frequency >6
  if (currentFrequency > 6) {
    findings.push({
      severity: "critical",
      stage: "audience",
      message: `Audience exhaustion: frequency has reached ${currentFrequency.toFixed(1)} (${frequencyChange > 0 ? "+" : ""}${frequencyChange.toFixed(1)}% WoW). At this level, users are seeing ads 6+ times per week, causing ad blindness and negative brand sentiment.`,
      recommendation:
        "Expand audience targeting immediately — creative rotation alone won't fix this. Add lookalike audiences at broader percentages, expand interest targeting, or test broad targeting. Consider excluding recent converters and high-frequency users. If budget allows, test new prospecting audiences.",
    });
    return findings; // Don't stack multiple frequency findings
  }

  // Tier 2: High frequency with declining CTR — creative fatigue root cause
  if (currentFrequency > 3 && ctrChange < -10) {
    findings.push({
      severity: "warning",
      stage: "audience",
      message: `High frequency (${currentFrequency.toFixed(1)}) with declining CTR (${ctrChange.toFixed(1)}% WoW). The audience is being over-served — this is the root cause of creative fatigue rather than the creative itself being bad.`,
      recommendation:
        "At frequency 3-6, creative rotation is the first lever — introduce 2-3 new creative variations with different hooks, formats, or angles. If frequency continues rising after creative refresh, expand the audience pool. Consider frequency capping if the platform supports it.",
    });
    return findings;
  }

  // Tier 3: Proactive warning — frequency rising
  if (currentFrequency > 3 && frequencyChange > 15) {
    findings.push({
      severity: "info",
      stage: "audience",
      message: `Frequency rising: ${previousFrequency.toFixed(1)} → ${currentFrequency.toFixed(1)} (+${frequencyChange.toFixed(1)}% WoW). If this trend continues, expect CTR declines within 1-2 weeks.`,
      recommendation:
        "Prepare fresh creative variations now. Monitor CTR closely — if it starts declining, accelerate the creative refresh. Consider gradually expanding audience targeting to slow the frequency increase.",
    });
  }

  // Tier 4: Low frequency with stable/improving metrics — healthy
  if (
    currentFrequency > 0 &&
    currentFrequency <= 2 &&
    ctrChange >= -5
  ) {
    findings.push({
      severity: "healthy",
      stage: "audience",
      message: `Audience reach is healthy: frequency at ${currentFrequency.toFixed(1)} with stable engagement.`,
      recommendation: null,
    });
  }

  return findings;
};
