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
// Bid Strategy Mismatch Advisor
// ---------------------------------------------------------------------------
// Conditions recommendations based on the bid strategy in use.
// Different strategies (lowest cost, cost cap, target ROAS, bid cap)
// exhibit different behaviors:
//
// - Lowest cost: CPA fluctuates with auction pressure. Spend is usually
//   fully delivered. Warning signs: CPA up + impressions up (algorithm
//   buying lower-quality traffic).
//
// - Cost cap: CPA stays near cap but delivery may drop when the cap
//   is too tight. Warning signs: under-delivery + stable CPA (cap is
//   throttling profitable impressions).
//
// - Target ROAS: ROAS stays near target but volume may drop. Warning
//   signs: conversions down + ROAS near target (algorithm is correctly
//   pruning low-ROAS traffic — but business needs volume).
//
// - Bid cap: Hard ceiling on bid. Warning signs: severe under-delivery
//   when auction prices exceed the cap.
//
// Stored in topLevel.bid_strategy by platform clients.
// Values: "lowest_cost" | "cost_cap" | "target_roas" | "bid_cap"
// ---------------------------------------------------------------------------

/** Bid strategy type — normalized across platforms */
export type BidStrategy =
  | "lowest_cost"
  | "cost_cap"
  | "target_roas"
  | "bid_cap";

/**
 * Parse bid strategy from the topLevel snapshot.
 * Platform clients store the bid strategy as a numeric code or string
 * in topLevel.bid_strategy.
 */
function parseBidStrategy(snapshot: MetricSnapshot): BidStrategy | null {
  const raw = snapshot.topLevel.bid_strategy;
  if (raw === undefined) return null;

  // Map numeric codes (used by some platform clients)
  switch (raw) {
    case 1:
      return "lowest_cost";
    case 2:
      return "cost_cap";
    case 3:
      return "target_roas";
    case 4:
      return "bid_cap";
    default:
      return null;
  }
}

export const bidStrategyAdvisor: FindingAdvisor = (
  stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  _context?: DiagnosticContext
): Finding[] => {
  const findings: Finding[] = [];

  const strategy = parseBidStrategy(current);
  if (!strategy) return findings;

  const spendChange =
    previous.spend > 0 ? percentChange(current.spend, previous.spend) : 0;

  const currentCPM = current.topLevel.cpm ?? 0;
  const previousCPM = previous.topLevel.cpm ?? 0;
  const cpmChange = previousCPM > 0 ? percentChange(currentCPM, previousCPM) : 0;

  const currentCPA = current.topLevel.cost_per_conversion
    ?? current.topLevel.cost_per_complete_payment
    ?? current.topLevel.cost_per_lead
    ?? 0;
  const previousCPA = previous.topLevel.cost_per_conversion
    ?? previous.topLevel.cost_per_complete_payment
    ?? previous.topLevel.cost_per_lead
    ?? 0;
  const cpaChange = previousCPA > 0 ? percentChange(currentCPA, previousCPA) : 0;

  // Find conversion stage for volume analysis
  const conversionStage = stageAnalysis.find(
    (s) =>
      s.metric === "purchase" ||
      s.metric === "conversions" ||
      s.metric === "complete_payment" ||
      s.metric === "lead"
  );
  const conversionChange = conversionStage?.deltaPercent ?? 0;

  switch (strategy) {
    case "lowest_cost":
      handleLowestCost(findings, cpaChange, cpmChange, conversionChange);
      break;
    case "cost_cap":
      handleCostCap(findings, cpaChange, spendChange, currentCPA);
      break;
    case "target_roas":
      handleTargetROAS(findings, current, previous, conversionChange);
      break;
    case "bid_cap":
      handleBidCap(findings, spendChange, cpmChange);
      break;
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Strategy-specific handlers
// ---------------------------------------------------------------------------

function handleLowestCost(
  findings: Finding[],
  cpaChange: number,
  cpmChange: number,
  conversionChange: number
): void {
  // Lowest cost: CPA up + impressions/conversions up = buying lower-quality traffic
  if (cpaChange > 20 && conversionChange > 10) {
    findings.push({
      severity: "warning",
      stage: "bid_strategy",
      message: `Lowest cost bid strategy: CPA increased ${cpaChange.toFixed(1)}% while conversion volume also rose ${conversionChange.toFixed(1)}%. The algorithm is buying incrementally more expensive traffic to maintain volume.`,
      recommendation:
        "With lowest cost bidding, the algorithm maximizes volume at any cost. Consider switching to cost cap to set a CPA ceiling, or reduce budget to force the algorithm to focus on the most efficient impressions.",
    });
    return;
  }

  // CPA up + CPM up = auction competition, not algorithm issue
  if (cpaChange > 20 && cpmChange > 15) {
    findings.push({
      severity: "info",
      stage: "bid_strategy",
      message: `Lowest cost bid strategy: CPA increased ${cpaChange.toFixed(1)}% alongside CPM increase of ${cpmChange.toFixed(1)}%. This appears to be auction competition rather than a targeting issue.`,
      recommendation:
        "With lowest cost bidding during rising auction costs, consider cost cap to protect CPA, or wait for competition to subside. Lowest cost has no guardrails against CPM spikes.",
    });
  }
}

function handleCostCap(
  findings: Finding[],
  cpaChange: number,
  spendChange: number,
  currentCPA: number
): void {
  // Cost cap: under-delivery + stable CPA = cap is too tight
  if (spendChange < -20 && Math.abs(cpaChange) < 10) {
    findings.push({
      severity: "warning",
      stage: "bid_strategy",
      message: `Cost cap bid strategy: spend dropped ${spendChange.toFixed(1)}% while CPA remained stable near $${currentCPA.toFixed(2)}. The cost cap is likely throttling delivery by rejecting profitable impressions above the cap.`,
      recommendation:
        "Increase the cost cap by 10-20% to allow more delivery volume. The stable CPA indicates the algorithm is efficiently filtering, but the cap may be too close to the actual market clearing price. Monitor for 2-3 days after adjusting.",
    });
    return;
  }

  // Cost cap: CPA exceeding cap = market has shifted above the cap
  if (cpaChange > 25) {
    findings.push({
      severity: "warning",
      stage: "bid_strategy",
      message: `Cost cap bid strategy: CPA increased ${cpaChange.toFixed(1)}% to $${currentCPA.toFixed(2)}, potentially exceeding the cost cap. The algorithm may have exhausted efficient inventory within the cap.`,
      recommendation:
        "If CPA is exceeding the cap, check if the cap is still realistic for current market conditions. Either raise the cap to match market rates or refresh creative/audiences to unlock more efficient inventory.",
    });
  }
}

function handleTargetROAS(
  findings: Finding[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  conversionChange: number
): void {
  const currentROAS = current.topLevel.roas
    ?? current.topLevel.complete_payment_roas
    ?? 0;
  const previousROAS = previous.topLevel.roas
    ?? previous.topLevel.complete_payment_roas
    ?? 0;
  const roasChange = previousROAS > 0 ? percentChange(currentROAS, previousROAS) : 0;

  // Target ROAS: conversions down + ROAS stable = algorithm correctly pruning
  if (conversionChange < -15 && Math.abs(roasChange) < 10 && currentROAS > 0) {
    findings.push({
      severity: "info",
      stage: "bid_strategy",
      message: `Target ROAS bid strategy: conversion volume dropped ${conversionChange.toFixed(1)}% while ROAS remained stable at ${currentROAS.toFixed(2)}x. The algorithm is maintaining the ROAS target by reducing volume.`,
      recommendation:
        "This is the target ROAS strategy working as intended — it sacrifices volume to maintain efficiency. If you need more volume, lower the ROAS target gradually (10% decrements). If volume is acceptable, no action needed.",
    });
    return;
  }

  // Target ROAS: ROAS dropping significantly = market shift or fatigue
  if (roasChange < -20) {
    findings.push({
      severity: "warning",
      stage: "bid_strategy",
      message: `Target ROAS bid strategy: ROAS dropped ${roasChange.toFixed(1)}% from ${previousROAS.toFixed(2)}x to ${currentROAS.toFixed(2)}x. The algorithm is struggling to maintain the target.`,
      recommendation:
        "Declining ROAS despite target ROAS bidding suggests structural issues: creative fatigue, audience saturation, or AOV decline. Check creative and audience health before adjusting the ROAS target. Lowering the target should be a last resort.",
    });
  }
}

function handleBidCap(
  findings: Finding[],
  spendChange: number,
  cpmChange: number
): void {
  // Bid cap: severe under-delivery = auction prices exceed the cap
  if (spendChange < -30) {
    findings.push({
      severity: cpmChange > 20 ? "critical" : "warning",
      stage: "bid_strategy",
      message: `Bid cap strategy: spend dropped ${spendChange.toFixed(1)}% WoW${cpmChange > 0 ? ` as CPMs rose ${cpmChange.toFixed(1)}%` : ""}. Auction prices appear to have exceeded the bid cap, causing significant under-delivery.`,
      recommendation:
        "Bid cap creates a hard ceiling — when auction prices rise above it, delivery stops entirely. Raise the bid cap to match current market rates, or switch to cost cap which allows some over-cap impressions while keeping the average near target. Consider whether the bid cap is still appropriate for current market conditions.",
    });
  }
}
