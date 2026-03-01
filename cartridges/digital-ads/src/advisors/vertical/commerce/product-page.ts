import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Product Page Advisor (commerce vertical — Meta + TikTok)
// ---------------------------------------------------------------------------
// When view_content→ATC drops, the product page isn't converting browsers
// into shoppers. Requires VC and ATC stages in the funnel.
// ---------------------------------------------------------------------------

export const productPageAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot
): Finding[] => {
  const findings: Finding[] = [];
  const vcToATC = dropoffs.find(
    (d) => d.fromStage === "view_content" && d.toStage === "add_to_cart"
  );

  if (vcToATC && vcToATC.deltaPercent < -20) {
    findings.push({
      severity: vcToATC.deltaPercent < -40 ? "critical" : "warning",
      stage: "view_content → add_to_cart",
      message: `View-content-to-ATC rate dropped ${vcToATC.deltaPercent.toFixed(1)}% (${(vcToATC.previousRate * 100).toFixed(2)}% → ${(vcToATC.currentRate * 100).toFixed(2)}%). Visitors are viewing products but not adding to cart.`,
      recommendation:
        "Check if pricing, shipping costs, or stock availability changed. Review if product page layout was modified. Consider adding urgency elements (limited stock, time-limited offers) or social proof (reviews, purchase counts).",
    });
  }

  return findings;
};
