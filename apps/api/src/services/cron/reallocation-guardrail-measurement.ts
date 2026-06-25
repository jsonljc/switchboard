import type { GuardrailMeasurement, PendingReallocation } from "@switchboard/ad-optimizer";

/**
 * Real-dep measurement provider for the reallocation guardrail monitor (runbook §1). For one applied
 * reallocation it measures the contract's guardrail shares over their windows plus the campaign's
 * current live budget (for sizing the rollback). Fail-closed: a metric it cannot read is OMITTED so
 * the pure `evaluateBlastRadiusGuardrails` trips (a money monitor cannot "pass" what it could not
 * measure). The two metrics:
 *
 *  - account_booked_conversions_drop_share: the share by which account-level booked conversions
 *    dropped in the post-move window [appliedAt, appliedAt+w) vs an equal-length pre-move baseline
 *    [appliedAt-w, appliedAt). A null booked-count read (CRM unavailable) OMITS the metric. A zero
 *    baseline yields a 0 drop (you cannot drop below zero bookings), which is a measured pass, not an
 *    absence.
 *  - freed_budget_absorbed_share: v1 is BUDGET-INCREASE-ONLY, so an increase frees no budget
 *    (freedCents = max(0, prior - currentLive) = 0) and the share is definitionally 0 (the harm it
 *    guards, re-absorption of freed budget, cannot occur for an increase). A DECREASE (freed > 0,
 *    deferred to the review_budget path) OMITS the metric -> trips, because absorption measurement is
 *    not built yet. An unreadable live budget OMITS it too (freed is uncomputable).
 */
export interface ReallocationGuardrailMeasurementDeps {
  /** The campaign's current live daily budget (cents), or null when unreadable (Meta outage / bad
   *  topology). Null becomes NaN downstream so the rollback is sized as unrestorable. */
  getCampaignBudgetCents: (deploymentId: string, campaignId: string) => Promise<number | null>;
  /** Account-level booked-conversion count over a half-open window, or null when unmeasurable (the
   *  CRM store threw / is unavailable). Zero is honest absence (a measured zero), never null. */
  getBookedCountForWindow: (args: {
    organizationId: string;
    startInclusive: Date;
    endExclusive: Date;
  }) => Promise<number | null>;
}

export function buildReallocationGuardrailMeasurement(
  deps: ReallocationGuardrailMeasurementDeps,
): (r: PendingReallocation) => Promise<GuardrailMeasurement> {
  return async (r) => {
    const shares: GuardrailMeasurement["shares"] = {};

    // Read the live budget once (window-independent). Null -> NaN: planReallocationRollback then
    // returns null (rollback_unrestorable) and the freed-budget computation is omitted.
    const liveRaw = await deps.getCampaignBudgetCents(r.deploymentId, r.campaignId);
    const currentLiveCents = liveRaw === null ? Number.NaN : liveRaw;

    for (const g of r.contract.guardrails) {
      if (g.metric === "account_booked_conversions_drop_share") {
        const windowMs = g.windowHours * 60 * 60 * 1000;
        const post = await deps.getBookedCountForWindow({
          organizationId: r.organizationId,
          startInclusive: r.appliedAt,
          endExclusive: new Date(r.appliedAt.getTime() + windowMs),
        });
        const baseline = await deps.getBookedCountForWindow({
          organizationId: r.organizationId,
          startInclusive: new Date(r.appliedAt.getTime() - windowMs),
          endExclusive: r.appliedAt,
        });
        // Either read unmeasurable -> OMIT (the guardrail trips on the missing reading).
        if (post !== null && baseline !== null) {
          shares.account_booked_conversions_drop_share =
            baseline > 0 ? Math.max(0, (baseline - post) / baseline) : 0;
        }
      } else if (g.metric === "freed_budget_absorbed_share") {
        if (Number.isFinite(currentLiveCents)) {
          const freedCents = Math.max(0, r.observedPriorCents - currentLiveCents);
          // v1 increase-only: freed is 0 -> 0% absorbed (definitional, safe). A decrease (freed > 0)
          // is the deferred review_budget path whose absorption we cannot yet measure: OMIT -> trips.
          if (freedCents === 0) {
            shares.freed_budget_absorbed_share = 0;
          }
        }
        // currentLiveCents NaN -> freed uncomputable -> OMIT -> trips.
      }
    }

    return { shares, currentLiveCents };
  };
}
