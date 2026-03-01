import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Form Conversion Advisor (leadgen vertical)
// ---------------------------------------------------------------------------
// Monitors click-to-lead rate. For instant forms this is typically high
// (10-30%) since the form is on-platform and pre-filled. A drop here
// means form friction or audience mismatch.
// ---------------------------------------------------------------------------

export const formConversionAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot
): Finding[] => {
  const findings: Finding[] = [];
  const clickToLead = dropoffs.find(
    (d) => d.fromStage === "click" && d.toStage === "lead"
  );

  if (!clickToLead) return findings;

  if (clickToLead.deltaPercent < -20) {
    findings.push({
      severity: clickToLead.deltaPercent < -40 ? "critical" : "warning",
      stage: "click → lead",
      message: `Click-to-lead conversion rate dropped ${clickToLead.deltaPercent.toFixed(1)}% (${(clickToLead.previousRate * 100).toFixed(1)}% → ${(clickToLead.currentRate * 100).toFixed(1)}%). Users are opening the form but not completing it.`,
      recommendation:
        "Check if the form was recently modified (added questions, changed fields). For instant forms, keep it to 3-5 fields max. Verify the form preview/context card matches what the ad promises. If using custom questions, check if any are confusing or causing drop-off.",
    });
  }

  // Absolute check — instant forms should have high conversion rates
  if (clickToLead.currentRate < 0.08 && clickToLead.currentRate > 0) {
    findings.push({
      severity: "info",
      stage: "click → lead",
      message: `Click-to-lead rate is ${(clickToLead.currentRate * 100).toFixed(1)}%, which is below the typical 10-30% range for instant forms.`,
      recommendation:
        "Instant forms should convert well due to pre-filled fields and on-platform experience. A low rate suggests too many form fields, confusing custom questions, or a mismatch between the ad promise and the form content.",
    });
  }

  return findings;
};
