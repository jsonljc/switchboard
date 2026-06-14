/**
 * Pure pre-write guards for the Spec-1B campaign budget reallocation. Layer 2 (imports nothing).
 * The executor (apps/api, Layer 5) composes these with the live Meta re-read and the blast-radius
 * cap before the budget write (close-the-revenue-loop spec section 7).
 */

/** Drift verdict: the live budget either matches the frozen approved "from" (ok) or it does not. */
export type BudgetDriftVerdict = { ok: true } | { ok: false; reason: "BUDGET_DRIFTED" };

/**
 * Fail-closed drift check. The human approved an exact "fromCents -> toCents" frozen payload; at
 * execution time the executor re-reads the LIVE daily budget. If live != frozen "from", the world
 * moved under the approval: refuse, never write a stale move. NaN-guarded defensively (the executor
 * guarantees finite inputs, having already mapped a null/unreadable read to UNSUPPORTED_BUDGET_TOPOLOGY
 * or CAMPAIGN_BUDGET_UNREADABLE before calling this; the guard is a belt per
 * feedback_nan_blind_comparison_gates).
 */
export function assessBudgetDrift(frozenFromCents: number, liveCents: number): BudgetDriftVerdict {
  if (!Number.isFinite(frozenFromCents) || !Number.isFinite(liveCents)) {
    return { ok: false, reason: "BUDGET_DRIFTED" };
  }
  if (liveCents !== frozenFromCents) return { ok: false, reason: "BUDGET_DRIFTED" };
  return { ok: true };
}

/**
 * Signed delta (for the blast-radius cap + the ExecutionReceipt) and its non-negative magnitude
 * (for the governance spend gate, which sizes on absolute dollars). Returns null on a non-finite
 * input so a caller never sees a NaN delta (a NaN would sail through a `>` cap; spec section 3.5,
 * feedback_nan_blind_comparison_gates). Cents in, cents out - the dollars normalization happens once
 * at the gate boundary and at trueRoas, never here.
 */
export function computeBudgetDelta(
  currentCents: number,
  proposedCents: number,
): { deltaCentsSigned: number; deltaCentsMagnitude: number } | null {
  if (!Number.isFinite(currentCents) || !Number.isFinite(proposedCents)) return null;
  const deltaCentsSigned = proposedCents - currentCents;
  return { deltaCentsSigned, deltaCentsMagnitude: Math.abs(deltaCentsSigned) };
}
