import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  EmittableOwnershipClassSchema as EmittableOwnershipClass,
  RecommendationOutputSchema as RecommendationOutput,
  UrgencySchema as Urgency,
} from "@switchboard/schemas";
import { emittedRiskContractFor } from "./recommendation-risk-contract.js";
import { shouldAbstainFromHandoff } from "./recommendation-handoff-abstention.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";

/**
 * Riley v3 (spec 2.2 net-new item 1): ownership as ONE derivation instead of five
 * scattered fragments. Classifies who SHOULD own the fix for a recommendation;
 * no class records a consummated action (operator_swipe does not mean a swipe
 * happened; mira_handoff means "Mira-owned by the live handoff gate", NOT
 * "submitted to Mira": surface routing, submitter wiring, and deploymentId are
 * dispatch mechanics, annotated elsewhere when a consumer needs dispatch truth).
 *
 *   mira_handoff      the LIVE handoff abstention clears (allowlist -> evidence
 *                     floor -> learning lock; the same shouldAbstainFromHandoff
 *                     the dispatch runs, called directly, never re-implemented)
 *   operator_swipe    the dashboard's canSwipeApprove predicate over the emitted
 *                     risk contract (cross-package parity tripwire:
 *                     apps/dashboard .../swipe-policy.parity.test.ts)
 *   human_escalation  the dashboard's needsConfirm tier reduced to its reachable
 *                     arm for Riley emitted contracts (riskLevel high;
 *                     requiresConfirmation is constant-false and the contract is
 *                     always present at this site; the missing-contract arm
 *                     guards legacy/non-Riley rows, out of scope here)
 *   operator_approval the default tier
 *
 * Precedence (first match): mira_handoff -> operator_swipe -> human_escalation ->
 * operator_approval. Handoff-and-swipe is structurally impossible (creative
 * actions elevate to mutating); swipe-and-escalation is impossible (low vs high
 * risk); the only live overlap, handoff-and-escalation, resolves to mira_handoff
 * by live-behavior fidelity (the dispatch hands off regardless of urgency; the
 * parked draft IS the governed approval ceremony).
 *
 * HONEST INPUT SET (recorded in the plan, spec 7.7 discipline): action, urgency,
 * and the captured per-campaign handoff context. revenueState is deliberately NOT
 * an input (no live ownership gate reads it), and neither is any governance-mode
 * snapshot (the gate's verdict is per-request at act/submit time in core; an
 * injected snapshot would be a fabricated read). riley_self therefore does NOT
 * come from this classifier at all: since the Phase-C pause wiring it is applied
 * by deriveOwnershipAnnotations from the sink's PARK FACT (pauseParkedIndex, the
 * one honestly-known run-specific signal; see that function's doc), never from
 * gate eligibility alone.
 *
 * Ownership ANNOTATES; it gates nothing.
 */

export interface DeriveOwnershipInput {
  action: AdRecommendationAction;
  urgency: Urgency;
  /** The campaign's captured handoff-gate inputs (evidence + learning phase).
   * Absent for account-scoped and signal recs (and any campaign outside this
   * cycle's insight set); absence fails the handoff arm honestly, mirroring
   * buildHandoffCandidate's null-without-context. */
  handoffContext?: HandoffCampaignContext | undefined;
}

export function deriveOwnership(input: DeriveOwnershipInput): EmittableOwnershipClass {
  if (input.handoffContext) {
    const abstention = shouldAbstainFromHandoff({
      actionType: input.action,
      evidence: input.handoffContext.evidence,
      learningPhaseActive: input.handoffContext.learningPhaseActive,
    });
    if (!abstention.abstain) return "mira_handoff";
  }
  const contract = emittedRiskContractFor(input.action, input.urgency);
  if (
    contract.riskLevel === "low" &&
    !contract.externalEffect &&
    !contract.financialEffect &&
    !contract.clientFacing
  ) {
    return "operator_swipe";
  }
  if (contract.requiresConfirmation || contract.riskLevel === "high") {
    return "human_escalation";
  }
  return "operator_approval";
}

/** One ownership entry per recommendations[] element (the report-level annotation;
 * same entry-identity rule as arbitration: index = array position). */
export interface OwnershipAnnotation {
  campaignId: string;
  action: AdRecommendationAction;
  index: number;
  ownership: EmittableOwnershipClass;
}

/** Total annotation over the final candidate set: one entry per recommendation,
 * same order. Pure; never mutates input. */
export function deriveOwnershipAnnotations(args: {
  recommendations: ReadonlyArray<RecommendationOutput>;
  handoffContextByCampaign?: ReadonlyMap<string, HandoffCampaignContext> | undefined;
  /** STRICT-TRUTH riley_self (Phase-C): the index whose pause submit ACTUALLY
   * PARKED this run (the sink's pauseParkedIndex). The park fact is the only
   * discriminator: gate eligibility alone (flag on, class eligible, floor met)
   * never relabels, so a flag-on-but-failed submit honestly stays
   * operator_approval. deriveOwnership itself is unchanged: every other
   * eligibility check already happened upstream of the park. */
  pauseParkedIndex?: number | undefined;
}): OwnershipAnnotation[] {
  return args.recommendations.map((r, index) => ({
    campaignId: r.campaignId,
    action: r.action,
    index,
    ownership:
      args.pauseParkedIndex !== undefined && index === args.pauseParkedIndex
        ? // A parked self-execution is Riley-owned; the approval ceremony is the
          // gate (the same shape as mira_handoff's parked draft).
          "riley_self"
        : deriveOwnership({
            action: r.action,
            urgency: r.urgency,
            handoffContext: args.handoffContextByCampaign?.get(r.campaignId),
          }),
  }));
}
