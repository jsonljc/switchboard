import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  UrgencySchema as Urgency,
} from "@switchboard/schemas";
import { ACTION_CONTRACT } from "./action-contract.js";

/**
 * Riley v3 (spec 2.2): the single PURE producer of the five risk-contract fields
 * a Riley recommendation emits. The sink (emission), the ownership derivation
 * (recommendation-ownership.ts), and the dashboard swipe-policy parity tripwire
 * (apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts) all
 * read THIS module, so the emitted shape can never fork. Deliberately free of
 * emission machinery: this module is part of the package's public pure API; the
 * sink is not.
 */

/**
 * Map ad-optimizer urgency (immediate / this_week / next_cycle) to the
 * Recommendation riskLevel enum (low / medium / high) used by the core router.
 * Urgency reflects "how soon should this be acted on": that aligns with risk
 * for the v1 router (high-urgency items are time-sensitive financial signals).
 * Moved here from recommendation-sink.ts (it was module-private there).
 */
export const URGENCY_TO_RISK: Record<Urgency, "low" | "medium" | "high"> = {
  immediate: "high",
  this_week: "medium",
  next_cycle: "low",
};

/**
 * INVARIANT (Phase-A spec section 5/7): a learning-resetting action is a
 * material, hard-to-undo change even when no dollars move, so externalEffect
 * bakes the elevation (resetsLearning === "yes" forces it true; the router
 * treats externalEffect=true as "not swipe-approvable"). Riley does not message
 * clients (clientFacing always false) and riskLevel drives the UI confirm step
 * (requiresConfirmation always false).
 */
export interface EmittedRiskContract {
  riskLevel: "low" | "medium" | "high";
  financialEffect: boolean;
  externalEffect: boolean;
  clientFacing: boolean;
  requiresConfirmation: boolean;
}

export function emittedRiskContractFor(
  action: AdRecommendationAction,
  urgency: Urgency,
): EmittedRiskContract {
  const contract = ACTION_CONTRACT[action];
  return {
    riskLevel: URGENCY_TO_RISK[urgency],
    financialEffect: contract.financialEffect,
    externalEffect: contract.externalEffect || contract.resetsLearning === "yes",
    clientFacing: false,
    requiresConfirmation: false,
  };
}
