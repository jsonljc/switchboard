import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import {
  isPhaseCActionClassEligible,
  meetsEvidenceFloor,
  type Evidence,
} from "@switchboard/ad-optimizer";

// UNWIRED: nothing live imports this module or this string. The prefix in the symbol
// name is deliberate; do not "clean it up" until the Phase-C wiring session resolves
// the final intent name, Riley-self deployment resolution, and governance seeding.
// PHASE-C: intent name + Riley deployment resolution + governance seeding unresolved.
export const UNWIRED_RILEY_PAUSE_INTENT = "adoptimizer.campaign.pause";

export interface RileyPauseSubmitInput {
  organizationId: string;
  recommendationId: string;
  campaignId: string;
  rationale: string;
  evidence: Evidence;
}

/**
 * PHASE-C SEAM (Riley v3 slice 5): designed-but-unwired, and intentionally PAUSE-ONLY.
 * Build the canonical submit request for Riley SELF-EXECUTING a pause through the
 * governed path. No live code calls this; the PRIMARY safety invariant is "no live
 * importer" (grep-proven per PR on both this module path and the intent string). As
 * defense in depth the governance engine is expected to default-deny the unregistered
 * intent, but this seam does not lean on that as a guarantee. The convention-parity
 * test ties this builder to the live handoff builder (recommendation-handoff-request.ts)
 * so drift in the real conventions breaks CI.
 *
 * Widening beyond pause requires a NEW PHASE_C_EXECUTION_SEAM entry and class review,
 * not a parameter on this function.
 *
 * Conventions mirrored from the live builder, on purpose:
 * - seeded `{ id: "system", type: "system" }` principal VERBATIM (trace root; a
 *   bespoke system:<x> id hard-denies with empty outputs);
 * - `deployment` REQUIRED and threaded into targetHint (the top-level resolver does
 *   not fall back to api-direct; it must be Riley's OWN per-org deployment, never
 *   Mira's creative deployment);
 * - idempotency key `mutate:riley:<recommendationId>:pause` mirrors the live
 *   `handoff:riley:<recId>:<action>` 4-segment shape under a distinct namespace.
 *   Both assume recommendation ids are globally unique, which holds: they are Prisma
 *   cuid() primary keys, so no org segment is needed;
 * - returns NULL on abstention (below the destructive-family evidence floor, or the
 *   action class is not Phase-C eligible); the caller MUST then not submit. The floor
 *   is the package-wide family-keyed policy (pause is explicitly destructive,
 *   {clicks: 50, conversions: 5, days: 7}); it is the recommendation-time MINIMUM and
 *   the wiring session may raise the execution floor. The live builder's learning-lock
 *   leg only fires for resetsLearning === "yes" actions; class eligibility already
 *   requires "no", so that leg is structurally inert here and not replicated.
 * - the wiring session's call site MUST branch on `"approvalRequired" in response`
 *   before destructuring (ingress-route convention), and pause submits are expected
 *   to park for approval until trust is earned.
 */
export function buildRileyPauseSubmitRequest(
  input: RileyPauseSubmitInput,
  deployment: { deploymentId: string; skillSlug: string },
): CanonicalSubmitRequest | null {
  if (!isPhaseCActionClassEligible("pause")) {
    return null;
  }
  if (!meetsEvidenceFloor("pause", input.evidence)) {
    return null;
  }

  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: UNWIRED_RILEY_PAUSE_INTENT,
    parameters: {
      recommendationId: input.recommendationId,
      actionType: "pause",
      campaignId: input.campaignId,
      rationale: input.rationale,
      evidence: input.evidence,
    },
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: `mutate:riley:${input.recommendationId}:pause`,
    targetHint: { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug },
  };
}
