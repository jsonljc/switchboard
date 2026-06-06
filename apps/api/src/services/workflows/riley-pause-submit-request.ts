import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import {
  isPhaseCActionClassEligible,
  meetsEvidenceFloor,
  meetsRileyPauseExecutionFloor,
  type Evidence,
} from "@switchboard/ad-optimizer";

// PHASE-C WIRED (2026-06 wiring session): registered in
// bootstrap/contained-workflows.ts, governed by the seeded allow +
// require_approval(mandatory) policies (packages/db/src/seed/
// riley-pause-governance.ts), executed on approval by
// riley-pause-execution-workflow.ts. The initiator is the weekly-audit cron
// (riley-pause-dispatch seam), flag-gated per org and OFF by default.
export const RILEY_PAUSE_INTENT = "adoptimizer.campaign.pause";

export interface RileyPauseSubmitInput {
  organizationId: string;
  recommendationId: string;
  campaignId: string;
  rationale: string;
  evidence: Evidence;
}

/**
 * PHASE-C (Riley v3 slice 5, WIRED this session): intentionally PAUSE-ONLY.
 * Build the canonical submit request for Riley SELF-EXECUTING a pause through the
 * governed path. The convention-parity test ties this builder to the live handoff
 * builder (recommendation-handoff-request.ts) so drift in the real conventions
 * breaks CI.
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
 * - returns NULL on abstention (the action class is not Phase-C eligible, below the
 *   destructive-family recommendation floor, or below the RAISED execution floor:
 *   `meetsRileyPauseExecutionFloor` {clicks: 100, conversions: 10, days: 7}; the
 *   family floor {clicks: 50, conversions: 5, days: 7} stays as the inner belt). The
 *   caller MUST then not submit. The live builder's learning-lock leg only fires for
 *   resetsLearning === "yes" actions; class eligibility already requires "no", so
 *   that leg is structurally inert here and not replicated.
 * - the call site (rileyPauseSubmitter in bootstrap/inngest.ts) branches on
 *   `"approvalRequired" in response` before reading the result, and every pause
 *   submit parks for mandatory approval via the seeded policy.
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
  if (!meetsRileyPauseExecutionFloor(input.evidence)) {
    return null;
  }

  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: RILEY_PAUSE_INTENT,
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
