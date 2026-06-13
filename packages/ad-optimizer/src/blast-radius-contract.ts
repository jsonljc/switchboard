/**
 * Enforced blast-radius contract for an autonomously executed money move
 * (Spec-1B `adoptimizer.campaign.reallocate`). This is the ENFORCED counterpart
 * to the declarative `PhaseCExecutionContract` in action-contract.ts: that seam
 * carries human-readable reversibility/rollback/guardrail STRINGS for the
 * reversible, human-gated pause class (recorded, not enforced); this contract
 * carries machine-checked NUMERIC caps the executor refuses to exceed before the
 * platform write, for the autonomous reallocation class that moves real budget.
 * Distinct, too, from the skill-runtime `BlastRadiusLimiter` (packages/core),
 * which bounds the NUMBER of writes per window; this bounds the DOLLAR magnitude
 * and relative size of a single budget move.
 *
 * Layer 2 (schemas-only): this module imports nothing. The executor that calls
 * `assertWithinBlastRadius` lives in apps/api (Layer 5) and is Spec-1B's to build
 * (mirroring how `meetsRileyPauseExecutionFloor` is a pure ad-optimizer predicate
 * consumed by the apps/api pause executor). The outcome-attribution cron that
 * evaluates the guardrails lives in core (Layer 3) and is a FORWARD consumer
 * named by the strategy spec, not imported here.
 */

/**
 * A guardrail signal the forward monitor (the slice-3 outcome-attribution cron)
 * evaluates over its window and trips on. Machine-comparable, NOT prose: each
 * carries a numeric `breachAbove` threshold the cron compares a measured share
 * against. The metric union is CLOSED on purpose so the cron's evaluation is
 * exhaustive and a typo is a compile error (a `| string` member would collapse
 * the union to `string` and erase that safety).
 *
 * Both members are positive shares whose INCREASE is the harm (a larger booked-
 * conversions drop; more of the freed budget re-absorbed), so a guardrail's
 * `breachAbove` is always an upper bound the measured value must stay under.
 */
export type BlastRadiusGuardrailMetric =
  | "account_booked_conversions_drop_share"
  | "freed_budget_absorbed_share";

export interface BlastRadiusGuardrail {
  metric: BlastRadiusGuardrailMetric;
  /**
   * Numeric ceiling on the measured share; the cron trips when the measured
   * value exceeds it. NaN-guarded at evaluation time (the forward cron's job) so
   * a missing metric never silently "passes" the comparison.
   */
  breachAbove: number;
  /** Evaluation window in hours. */
  windowHours: number;
}

/**
 * Automated rollback for the reallocate class: on a tripped guardrail the monitor
 * re-sets the campaign's prior daily budget. The executor MUST capture the prior
 * value before the write (the read-modify-re-read executor, spec section 7) so the
 * rollback can restore it. The pause class keeps a HUMAN rollback (resume is a
 * human decision) in the declarative seam; this automated inverse is specifically
 * the reallocate-class response.
 */
export interface BlastRadiusRollback {
  kind: "reset_prior_budget";
  capturePriorValue: true;
}

/**
 * Blast-radius contract a self-/autonomously-executed money move carries
 * (Spec-1B). Every numeric field is machine-checked by the executor BEFORE the
 * platform write; a delta that breaches any cap is REFUSED (fail closed), never
 * clamped silently. Cents end-to-end (normalized to dollars exactly once at the
 * gate boundary, spec section 11).
 */
export interface BlastRadiusContract {
  /**
   * Hard ceiling on the absolute dollar delta this action may move, in CENTS. The
   * executor refuses a delta whose magnitude exceeds it.
   */
  maxDeltaCents: number;
  /**
   * Ceiling on the action's share of the account's current daily spend, 0..1.
   * Refused when `|deltaCents| / accountDailySpendCents` exceeds it. Guards the
   * "small account, large relative move" case a flat dollar cap misses.
   */
  maxAccountSpendShare: number;
  /** Guardrail thresholds the forward outcome-attribution cron evaluates. */
  guardrails: BlastRadiusGuardrail[];
  /** Automated breach response for the reallocate class. */
  rollback: BlastRadiusRollback;
}

/**
 * The verdict `assertWithinBlastRadius` returns: a money move is either within
 * every cap (`ok: true`) or refused with the first cap it breached. There is no
 * "clamp" path; a breach fails the action closed, it never silently shrinks the
 * move to fit.
 */
export type BlastRadiusVerdict = { ok: true } | { ok: false; reason: "DELTA_CAP" | "SHARE_CAP" };

/**
 * Pure cap check the Spec-1B reallocate executor calls immediately before the
 * Meta budget write, with the signed `deltaCents` (requested new budget minus
 * current) and the account's current `accountDailySpendCents` (both from the
 * executor's read-modify-re-read of live Meta state). Returns a refusal verdict
 * the executor turns into `outcome:"failed"` (recovery-required + operator card);
 * it NEVER clamps.
 *
 * Fail-closed on EVERY non-finite input and on a non-finite contract cap: a NaN
 * is the ABSENCE of a usable number, not a value of NaN, and `NaN > x` / `x > NaN`
 * are both false, so an unguarded comparison would let a missing reading sail
 * through (feedback_nan_blind_comparison_gates). The share leg also refuses a
 * non-positive denominator: a zero/negative account spend means the move cannot be
 * sized, which for a money move must refuse, not skip the cap.
 *
 * `SHARE_CAP` therefore covers both "share exceeds the cap" and "the account
 * cannot be sized, so no safe share is computable." First breach wins; the dollar
 * leg is checked first. Caps are inclusive: a delta exactly at a cap is allowed,
 * only one that exceeds it is refused.
 */
export function assertWithinBlastRadius(
  contract: BlastRadiusContract,
  deltaCents: number,
  accountDailySpendCents: number,
): BlastRadiusVerdict {
  // ── Dollar-cap leg ──
  if (!Number.isFinite(deltaCents)) return { ok: false, reason: "DELTA_CAP" };
  if (!Number.isFinite(contract.maxDeltaCents)) return { ok: false, reason: "DELTA_CAP" };
  if (Math.abs(deltaCents) > contract.maxDeltaCents) return { ok: false, reason: "DELTA_CAP" };

  // ── Share-cap leg ──
  if (!Number.isFinite(accountDailySpendCents) || accountDailySpendCents <= 0) {
    return { ok: false, reason: "SHARE_CAP" };
  }
  if (!Number.isFinite(contract.maxAccountSpendShare)) {
    return { ok: false, reason: "SHARE_CAP" };
  }
  const share = Math.abs(deltaCents) / accountDailySpendCents;
  if (share > contract.maxAccountSpendShare) return { ok: false, reason: "SHARE_CAP" };

  return { ok: true };
}
