import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";
import { percentChange } from "../../../core/analysis/significance.js";

// ---------------------------------------------------------------------------
// Qualified Cost Advisor (leadgen vertical)
// ---------------------------------------------------------------------------
// CPL can look fine while cost-per-QUALIFIED-lead is spiking.
// This is the metric that actually matters for the business.
// ---------------------------------------------------------------------------

export const qualifiedCostAdvisor: FindingAdvisor = (
  stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot
): Finding[] => {
  const findings: Finding[] = [];

  const qualifiedStage = stageAnalysis.find(
    (s) => s.stageName === "qualified_lead"
  );
  if (!qualifiedStage) return findings;

  const currentCPQL =
    qualifiedStage.currentValue > 0
      ? current.spend / qualifiedStage.currentValue
      : 0;
  const previousCPQL =
    qualifiedStage.previousValue > 0
      ? previous.spend / qualifiedStage.previousValue
      : 0;

  if (currentCPQL === 0 || previousCPQL === 0) return findings;

  const cpqlChange = percentChange(currentCPQL, previousCPQL);

  // Also check how CPL moved for comparison
  const leadStage = stageAnalysis.find((s) => s.stageName === "lead");
  const currentCPL =
    leadStage && leadStage.currentValue > 0
      ? current.spend / leadStage.currentValue
      : 0;
  const previousCPL =
    leadStage && leadStage.previousValue > 0
      ? previous.spend / leadStage.previousValue
      : 0;
  const cplChange = previousCPL > 0 ? percentChange(currentCPL, previousCPL) : 0;

  // Flag when CPQL is rising significantly faster than CPL
  if (cpqlChange > 20 && cpqlChange > cplChange + 15) {
    findings.push({
      severity: cpqlChange > 50 ? "critical" : "warning",
      stage: "qualified_lead",
      message: `Cost per qualified lead increased ${cpqlChange.toFixed(1)}% ($${previousCPQL.toFixed(2)} → $${currentCPQL.toFixed(2)}) while CPL only moved ${cplChange.toFixed(1)}%. The gap means you're paying for volume but not getting quality.`,
      recommendation:
        "This is the clearest signal that lead quality has degraded. Consider switching your campaign optimization to 'Conversion Leads' (optimize for qualified events via CAPI) instead of optimizing for lead volume. This tells Meta's algorithm to find people who actually convert downstream, not just people who fill out forms.",
    });
  }

  return findings;
};
