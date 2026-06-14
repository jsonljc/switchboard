import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  RecommendationSurface,
} from "@switchboard/schemas";
import type { Evidence } from "./evidence-floor.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";
import { computeBudgetDelta } from "./budget-reallocation-plan.js";

/**
 * SPEC-1B reallocation dispatch (the initiator's Layer-2 half). Mirrors
 * riley-pause-dispatch.ts: a pure candidate decision here, with the injected submitter callback
 * wired by apps/api (this package never imports PlatformIngress). The candidate carries the frozen
 * {adAccountId, campaignId, currentDailyBudgetCents, proposedDailyBudgetCents} the human approves and
 * the executor (Spec-1B PR 1B-1.5) replays under the blast-radius cap.
 */
export interface RileyBudgetCandidate {
  organizationId: string;
  /** Riley's own active per-org ad-optimizer deployment id (targetHint provenance). */
  deploymentId: string;
  /** The Meta ad-account that owns the campaign; frozen so the executor acts against the APPROVED
   *  account (lock key + account-spend denominator + receipt), never an inferred one. */
  adAccountId: string;
  recommendationId: string;
  campaignId: string;
  currentDailyBudgetCents: number;
  proposedDailyBudgetCents: number;
  rationale: string;
  evidence: Evidence;
}

/**
 * Bootstrap-injected submit sink (apps/api). Returns PARK TRUTH: parked=true only when the submit
 * actually parked for approval. Best-effort: implementations never throw into the audit.
 */
export type RileyBudgetSubmitter = (
  candidate: RileyBudgetCandidate,
) => Promise<{ parked: boolean }>;

/**
 * Decide whether ONE emitted recommendation becomes a reallocation candidate. Pure + deterministic.
 * The trigger is the `scale` recommendation (Riley's "scale the daily budget up ~20%" semantics); the
 * proposed budget is current x REALLOCATE_SCALE_FACTOR, sized by the sink. Abstains (returns null) for
 * any action other than `scale`, a dropped router surface, missing per-campaign context or ids, an
 * unknown (null) current/proposed budget, or a zero-magnitude no-op. The seeded require_approval(mandatory) policy is the real human gate; this only decides
 * whether there is a well-formed money move to surface. Arbitration ("which reallocation is the
 * primary") and the evidence floor are applied at the sink wiring (PR 1B-1.3), not here.
 */
export function buildRileyBudgetCandidate(args: {
  emitted: {
    recommendationId: string;
    actionType: AdRecommendationAction;
    campaignId: string;
    rationale: string;
    surface: RecommendationSurface;
  };
  currentDailyBudgetCents: number | null;
  proposedDailyBudgetCents: number | null;
  context: HandoffCampaignContext | undefined;
  organizationId: string;
  deploymentId: string;
  adAccountId: string;
}): RileyBudgetCandidate | null {
  const {
    emitted,
    currentDailyBudgetCents,
    proposedDailyBudgetCents,
    context,
    organizationId,
    deploymentId,
    adAccountId,
  } = args;
  if (emitted.actionType !== "scale") return null;
  if (emitted.surface === "dropped") return null;
  if (!context) return null;
  if (!deploymentId) return null;
  if (!adAccountId) return null;
  if (currentDailyBudgetCents === null || proposedDailyBudgetCents === null) return null;
  const delta = computeBudgetDelta(currentDailyBudgetCents, proposedDailyBudgetCents);
  if (!delta || delta.deltaCentsMagnitude === 0) return null;
  return {
    organizationId,
    deploymentId,
    adAccountId,
    recommendationId: emitted.recommendationId,
    campaignId: emitted.campaignId,
    currentDailyBudgetCents,
    proposedDailyBudgetCents,
    rationale: emitted.rationale,
    evidence: context.evidence,
  };
}
