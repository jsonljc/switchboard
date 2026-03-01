import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";
import { percentChange } from "../../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Lead Quality Advisor (leadgen vertical)
// ---------------------------------------------------------------------------
// The signature pattern: lead volume goes UP (or holds) while qualified
// lead volume goes DOWN. This means the form is capturing junk.
// ---------------------------------------------------------------------------

export const leadQualityAdvisor: FindingAdvisor = (
  stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot
): Finding[] => {
  const findings: Finding[] = [];

  const leadStage = stageAnalysis.find((s) => s.stageName === "lead");
  const qualifiedStage = stageAnalysis.find(
    (s) => s.stageName === "qualified_lead"
  );

  if (!leadStage || !qualifiedStage) return findings;

  // Can't assess quality if there's no qualified lead data
  if (qualifiedStage.currentValue === 0 && qualifiedStage.previousValue === 0) {
    return findings;
  }

  const leadDelta = leadStage.deltaPercent;
  const qualifiedDelta = qualifiedStage.deltaPercent;

  // Quality ratio: qualified / total leads
  const currentQualRate =
    leadStage.currentValue > 0
      ? qualifiedStage.currentValue / leadStage.currentValue
      : 0;
  const previousQualRate =
    leadStage.previousValue > 0
      ? qualifiedStage.previousValue / leadStage.previousValue
      : 0;
  const qualRateChange = percentChange(currentQualRate, previousQualRate);

  // Pattern 1: Volume up + quality down = junk leads
  if (leadDelta > 5 && qualifiedDelta < -15) {
    findings.push({
      severity: qualifiedDelta < -30 ? "critical" : "warning",
      stage: "lead → qualified_lead",
      message: `Lead volume increased ${leadDelta.toFixed(1)}% but qualified leads dropped ${qualifiedDelta.toFixed(1)}%. Quality rate fell from ${(previousQualRate * 100).toFixed(1)}% to ${(currentQualRate * 100).toFixed(1)}%. The form is generating unqualified leads.`,
      recommendation:
        "Switch instant forms from 'More Volume' to 'Higher Intent' optimization (adds a review screen before submit). Add qualifying questions to the form to filter out low-intent users. Consider conditional logic to disqualify early. If using Advantage+ audience, try narrowing with original audience controls.",
    });
  }

  // Pattern 2: Both volume and quality are dropping — different problem
  if (leadDelta < -15 && qualifiedDelta < -15 && qualRateChange > -10) {
    findings.push({
      severity: "warning",
      stage: "lead",
      message: `Both total leads (${leadDelta.toFixed(1)}%) and qualified leads (${qualifiedDelta.toFixed(1)}%) dropped while quality rate held (${qualRateChange.toFixed(1)}%). This is a volume/delivery issue, not a quality issue.`,
      recommendation:
        "The lead funnel is intact but getting less traffic. Check if budget was reduced, audience is exhausted, or CPMs increased. This is distinct from a quality problem.",
    });
  }

  // Pattern 3: Quality rate is chronically low (absolute check)
  if (currentQualRate < 0.08 && qualifiedStage.currentValue > 0) {
    findings.push({
      severity: "warning",
      stage: "qualified_lead",
      message: `Only ${(currentQualRate * 100).toFixed(1)}% of leads are qualifying. For instant forms, a healthy range is 15-40% with higher-intent optimization.`,
      recommendation:
        "This low qualification rate suggests the form is too easy to submit or is attracting the wrong audience. Consider: (1) switching to Higher Intent form type, (2) adding a custom question that requires effort to answer, (3) removing pre-filled fields that let users submit without thinking, (4) reviewing audience targeting for relevance.",
    });
  }

  return findings;
};
