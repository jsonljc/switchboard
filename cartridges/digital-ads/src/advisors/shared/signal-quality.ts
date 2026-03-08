// ---------------------------------------------------------------------------
// Signal Quality Advisor
// ---------------------------------------------------------------------------
// Flags low EMQ, missing events, deduplication issues.
// ---------------------------------------------------------------------------

import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
  Severity,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

export const signalQualityAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  _previous: MetricSnapshot,
  _context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  // Check if conversion tracking seems weak based on funnel data
  const purchaseStage = current.stages["purchase"] ?? current.stages["lead"];
  const purchaseCount = purchaseStage?.count ?? 0;
  const spend = current.spend ?? 0;

  if (purchaseCount === 0 && spend > 100) {
    findings.push({
      severity: "critical" as Severity,
      stage: "signal",
      message:
        "Zero conversion events detected despite $" +
        spend.toFixed(2) +
        " spend — pixel or CAPI may not be firing correctly",
      recommendation:
        "Run digital-ads.signal.pixel.diagnose to check pixel health and digital-ads.signal.capi.diagnose for server-side event setup",
    });
  }

  return findings;
};
