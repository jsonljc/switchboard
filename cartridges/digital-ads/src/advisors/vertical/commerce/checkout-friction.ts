import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Checkout Friction Advisor (commerce vertical — Meta + TikTok)
// ---------------------------------------------------------------------------
// When ATC→Purchase drops, there's friction at checkout.
// Requires ATC and purchase stages in the funnel.
// ---------------------------------------------------------------------------

export const checkoutFrictionAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot
): Finding[] => {
  const findings: Finding[] = [];
  const atcToPurchase = dropoffs.find(
    (d) => d.fromStage === "add_to_cart" && d.toStage === "purchase"
  );

  if (atcToPurchase && atcToPurchase.deltaPercent < -20) {
    findings.push({
      severity: atcToPurchase.deltaPercent < -35 ? "critical" : "warning",
      stage: "add_to_cart → purchase",
      message: `ATC-to-purchase rate dropped ${atcToPurchase.deltaPercent.toFixed(1)}% (${(atcToPurchase.previousRate * 100).toFixed(1)}% → ${(atcToPurchase.currentRate * 100).toFixed(1)}%). Shoppers are adding to cart but abandoning at checkout.`,
      recommendation:
        "Verify the purchase pixel event is firing correctly. Check if a payment gateway issue occurred. Review if shipping costs or delivery times changed. Look at checkout page for new friction (mandatory account creation, extra form fields).",
    });
  }

  // Absolute check — if ATC→Purchase rate is below 15%, flag it
  if (atcToPurchase && atcToPurchase.currentRate < 0.15 && atcToPurchase.currentRate > 0) {
    findings.push({
      severity: "info",
      stage: "add_to_cart → purchase",
      message: `Only ${(atcToPurchase.currentRate * 100).toFixed(1)}% of add-to-carts are converting to purchases. This is below the typical 20-50% range.`,
      recommendation:
        "Consider cart abandonment email/SMS sequences, simplifying checkout to fewer steps, or offering guest checkout if not already available.",
    });
  }

  return findings;
};
