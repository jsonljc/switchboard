import type { RiskContract } from "./types";

/**
 * Returns true only when swipe-to-approve is safe: contract present, risk is
 * low, and the action has no external, financial, or client-facing effect.
 * A missing contract (legacy/unknown decision) is treated as UNSAFE — returns false.
 */
export function canSwipeApprove(c?: RiskContract): boolean {
  return !!c && c.riskLevel === "low" && !c.externalEffect && !c.financialEffect && !c.clientFacing;
}

/**
 * Returns true when a tap-through confirmation is required: contract absent,
 * explicitly flagged, or risk is high.
 * A missing contract (legacy/unknown decision) always needs confirmation.
 */
export function needsConfirm(c?: RiskContract): boolean {
  return !c || c.requiresConfirmation || c.riskLevel === "high";
}
