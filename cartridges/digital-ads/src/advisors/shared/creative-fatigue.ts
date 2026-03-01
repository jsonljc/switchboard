import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";
import { percentChange } from "../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Creative Fatigue Advisor (universal — works across all platforms)
// ---------------------------------------------------------------------------
// When CTR drops significantly but CPM is stable or increasing,
// the audience is seeing the ads but not engaging — creative is stale.
//
// This pattern is universal across Meta, Google, and TikTok.
// The recommendation varies by vertical (commerce vs. leadgen).
// ---------------------------------------------------------------------------

export interface CreativeFatigueOptions {
  /** Override recommendation text (e.g. for leadgen-specific advice) */
  recommendation?: string;
}

export function createCreativeFatigueAdvisor(
  options?: CreativeFatigueOptions
): FindingAdvisor {
  const defaultRecommendation =
    "Introduce new creative variations. Test different hooks in the first 3 seconds of video, or swap primary images. Avoid changing targeting at the same time so you can isolate the variable.";

  return (
    _stageAnalysis: StageDiagnostic[],
    _dropoffs: FunnelDropoff[],
    current: MetricSnapshot,
    previous: MetricSnapshot
  ): Finding[] => {
    const findings: Finding[] = [];
    const currentCTR = current.topLevel.ctr ?? 0;
    const previousCTR = previous.topLevel.ctr ?? 0;
    const currentCPM = current.topLevel.cpm ?? 0;
    const previousCPM = previous.topLevel.cpm ?? 0;

    if (previousCTR === 0) return findings;

    const ctrChange = percentChange(currentCTR, previousCTR);
    const cpmChange =
      previousCPM > 0 ? percentChange(currentCPM, previousCPM) : 0;

    // CTR dropped > 15% while CPM didn't decrease
    if (ctrChange < -15 && cpmChange >= -5) {
      findings.push({
        severity: ctrChange < -30 ? "critical" : "warning",
        stage: "click",
        message: `CTR dropped ${ctrChange.toFixed(1)}% while CPMs held steady (${cpmChange > 0 ? "+" : ""}${cpmChange.toFixed(1)}%). This pattern indicates creative fatigue — the audience is being reached but not engaging.`,
        recommendation: options?.recommendation ?? defaultRecommendation,
      });
    }

    return findings;
  };
}

/** Default creative fatigue advisor (commerce-style recommendation) */
export const creativeFatigueAdvisor: FindingAdvisor =
  createCreativeFatigueAdvisor();

/** Leadgen-specific creative fatigue advisor */
export const leadgenCreativeFatigueAdvisor: FindingAdvisor =
  createCreativeFatigueAdvisor({
    recommendation:
      "Refresh creative with new angles. For leadgen, test different value propositions in the hook (free consultation, downloadable resource, limited spots). Lead magnets fatigue faster than product ads because the perceived value diminishes after repeated exposure.",
  });
