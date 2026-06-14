import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import { computeBudgetDelta, type Evidence } from "@switchboard/ad-optimizer";

// SPEC-1B act leg: the governed reallocation intent. Registered in
// bootstrap/contained-workflows.ts, gated by the seeded allow + require_approval(mandatory)
// policies (packages/db/src/seed/riley-budget-governance.ts), and (PR 1B-1.5) executed on approval
// by the read-modify-re-read executor. The initiator is the weekly-audit sink (PR 1B-1.3),
// flag-gated per org. NEVER system_auto_approved (already on the D9-2 denylist).
export const RILEY_REALLOCATE_INTENT = "adoptimizer.campaign.reallocate";

export interface RileyBudgetSubmitInput {
  organizationId: string;
  recommendationId: string;
  adAccountId: string;
  campaignId: string;
  fromCents: number;
  toCents: number;
  rationale: string;
  evidence: Evidence;
}

/**
 * SPEC-1B: build the canonical submit request for Riley reallocating a campaign's daily budget
 * through the governed path. Mirrors buildRileyPauseSubmitRequest's conventions on purpose:
 * - seeded `{ id: "system", type: "system" }` principal VERBATIM (a bespoke system:<x> hard-denies);
 * - `deployment` threaded into targetHint (Riley's OWN per-org deployment, never Mira's);
 * - idempotency key `mutate:riley:<recommendationId>:reallocate` mirrors the pause 4-segment shape
 *   under a distinct namespace (recommendation ids are globally unique cuids, no org segment needed);
 * - returns NULL on a malformed or no-op move (defense in depth: a zero-magnitude delta or a
 *   non-positive / non-integer cents value must never park). The call site branches on
 *   `"approvalRequired" in response` before reading the result, and every reallocate submit parks
 *   for mandatory approval via the seeded policy.
 *
 * The frozen `{ adAccountId, campaignId, fromCents, toCents }` is what the human approves and the
 * bindingHash content-binds; the executor (PR 1B-1.5) replays exactly this under the blast-radius cap.
 */
export function buildRileyBudgetSubmitRequest(
  input: RileyBudgetSubmitInput,
  deployment: { deploymentId: string; skillSlug: string },
): CanonicalSubmitRequest | null {
  const delta = computeBudgetDelta(input.fromCents, input.toCents);
  if (!delta || delta.deltaCentsMagnitude === 0) return null;
  if (!Number.isInteger(input.fromCents) || input.fromCents <= 0) return null;
  if (!Number.isInteger(input.toCents) || input.toCents <= 0) return null;

  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: RILEY_REALLOCATE_INTENT,
    parameters: {
      recommendationId: input.recommendationId,
      actionType: "shift_budget_to_source",
      adAccountId: input.adAccountId,
      campaignId: input.campaignId,
      fromCents: input.fromCents,
      toCents: input.toCents,
      rationale: input.rationale,
      evidence: input.evidence,
    },
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: `mutate:riley:${input.recommendationId}:reallocate`,
    targetHint: { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug },
  };
}
