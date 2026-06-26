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
 * unknown (null) current/proposed budget, or a zero-magnitude no-op. Those well-formedness checks are
 * the builder's ONLY gates; the seeded require_approval(mandatory) policy is the real human gate.
 *
 * Unlike the pause path, reallocate is NOT arbitration-primary-gated: the arbitrator's only
 * primary-gated consumer is pause self-submission (opportunity-arbitrator.ts), so multiple `scale`
 * reallocations may each surface for approval (the value-capture move pushes budget toward several
 * proven winners). And no evidence floor is applied HERE: the base scale-family floor is enforced
 * upstream at engine emission (recommendation-engine.ts Gate 2, which demotes a sub-floor scale rec
 * to an abstention watch before it can reach this builder), and there is no raised execution floor
 * for reallocate (the pause path's meetsRileyPauseExecutionFloor has no reallocate analogue). The
 * reallocate safety envelope is the mandatory human gate plus execution-time guardrails (the
 * blast-radius cap and kill-switch) and the post-execution guardrail monitor with automated
 * rollback, not candidate-side gating.
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
