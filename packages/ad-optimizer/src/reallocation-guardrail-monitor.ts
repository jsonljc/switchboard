/**
 * The forward guardrail-evaluation monitor + automated rollback DECISION for the
 * Spec-1B reallocate act-leg (the two HARD flip preconditions named in
 * docs/runbooks/riley-reallocation-go-live.md §1-2). Pure + injected-deps, in the
 * same shape as the weekly-audit cron: the LOGIC lives here (Layer 2, imports only
 * the contract + plan math); apps/api injects the real measurement provider and the
 * governed rollback dispatch (mirroring how the pause executor injects deps).
 *
 * After Riley autonomously moves a campaign budget, this monitor re-checks the
 * contract's guardrails over its window. On a breach it executes the
 * `reset_prior_budget` rollback from the executor's captured `observedPriorCents` —
 * undoing Riley's move back to the known-good prior state. Fail-closed throughout:
 * an UNMEASURABLE guardrail trips (a money monitor cannot "pass" what it could not
 * measure), and a per-item failure is isolated so it never starves the batch.
 */
import type {
  BlastRadiusContract,
  BlastRadiusGuardrail,
  BlastRadiusGuardrailMetric,
} from "./blast-radius-contract.js";
import { computeBudgetDelta } from "./budget-reallocation-plan.js";

// ─────────────────────────────── guardrail evaluation ───────────────────────────────

/** Why a guardrail tripped: the measured share EXCEEDED its ceiling, or it could not be
 *  measured at all (fail-closed). `measured` is NaN for the unmeasured case. */
export interface GuardrailBreach {
  metric: BlastRadiusGuardrailMetric;
  reason: "exceeded" | "unmeasured";
  measured: number;
  breachAbove: number;
}

export type GuardrailVerdict = { breached: false } | ({ breached: true } & GuardrailBreach);

/**
 * Evaluate a reallocation's contract guardrails against measured shares. Each guardrail's
 * `breachAbove` is an upper bound the measured share must stay strictly under; a value AT the
 * bound is allowed (only one that exceeds it trips). First breach wins (guardrail order).
 *
 * FAIL-CLOSED on a missing or non-finite measurement: a configured guardrail with no usable
 * reading TRIPS (reason "unmeasured"). `NaN > x` is false, so an unguarded comparison would let
 * a missing reading silently pass — for a money-safety monitor the safe direction is to roll
 * back to the known-good prior, never to keep a move it could not verify.
 */
export function evaluateBlastRadiusGuardrails(
  guardrails: readonly BlastRadiusGuardrail[],
  measured: Partial<Record<BlastRadiusGuardrailMetric, number>>,
): GuardrailVerdict {
  for (const g of guardrails) {
    const value = measured[g.metric];
    if (value === undefined || !Number.isFinite(value)) {
      return {
        breached: true,
        metric: g.metric,
        reason: "unmeasured",
        measured: NaN,
        breachAbove: g.breachAbove,
      };
    }
    if (value > g.breachAbove) {
      return {
        breached: true,
        metric: g.metric,
        reason: "exceeded",
        measured: value,
        breachAbove: g.breachAbove,
      };
    }
  }
  return { breached: false };
}

// ──────────────────────────────────── rollback plan ─────────────────────────────────

export type ReallocationRollbackPlan =
  | { noop: true }
  | { noop: false; targetCents: number; deltaCentsSigned: number };

/**
 * Plan the `reset_prior_budget` rollback: restore the executor-captured `observedPriorCents`.
 * Returns the signed delta from the current LIVE budget back to the prior (for the cap + receipt).
 * `noop` when the live budget already equals the prior (nothing to undo). `null` when the prior is
 * non-finite or non-positive (an unrestorable capture — the caller surfaces this rather than
 * writing a garbage budget); reuses the same finiteness-guarded delta math as the forward move.
 */
export function planReallocationRollback(
  observedPriorCents: number,
  currentLiveCents: number,
): ReallocationRollbackPlan | null {
  if (!Number.isFinite(observedPriorCents) || observedPriorCents <= 0) return null;
  const delta = computeBudgetDelta(currentLiveCents, observedPriorCents);
  if (delta === null) return null;
  if (delta.deltaCentsSigned === 0) return { noop: true };
  return { noop: false, targetCents: observedPriorCents, deltaCentsSigned: delta.deltaCentsSigned };
}

// ──────────────────────────────── monitor orchestrator ──────────────────────────────

export interface PendingReallocation {
  /** The forward reallocation's execution work unit: the rollback's `rollbackOfWorkUnitId` and the
   *  key the monitor marks resolved. */
  executionWorkUnitId: string;
  deploymentId: string;
  organizationId: string;
  /** The frozen ad account the rollback restores within. */
  adAccountId: string;
  campaignId: string;
  /** The pre-change daily budget the executor captured before the write (cents). The rollback
   *  restores to exactly this value. */
  observedPriorCents: number;
  /** When the forward move was applied; the measurement provider anchors the pre/post windows here. */
  appliedAt: Date;
  /** The blast-radius contract the move carried; its `guardrails` are evaluated here. */
  contract: BlastRadiusContract;
}

export interface GuardrailMeasurement {
  /** Measured guardrail shares over the contract's window. A metric absent here is UNMEASURED
   *  and trips the guardrail (fail-closed). */
  shares: Partial<Record<BlastRadiusGuardrailMetric, number>>;
  /** The campaign's live daily budget right now, for sizing the rollback delta (cents). */
  currentLiveCents: number;
}

export type ReallocationMonitorOutcome =
  | "held" // guardrails passed; the reallocation is kept
  | "rolled_back" // a guardrail tripped; the prior budget was restored
  | "rollback_noop" // tripped, but the live budget already equals the prior (nothing to undo)
  | "rollback_unrestorable"; // tripped, but observedPriorCents is unusable (bad capture) — must alarm

export interface ReallocationGuardrailMonitorDeps {
  /** Reallocations awaiting verification (executor-captured prior budget + the contract). */
  listPendingReallocations: () => Promise<PendingReallocation[]>;
  /** Measure the guardrail shares + live budget for one reallocation over its window. */
  measureGuardrails: (r: PendingReallocation) => Promise<GuardrailMeasurement>;
  /** Execute the rollback (restore observedPriorCents) through the GOVERNED write path. */
  dispatchRollback: (
    r: PendingReallocation,
    plan: { targetCents: number; deltaCentsSigned: number },
    breach: GuardrailBreach,
  ) => Promise<void>;
  /** Mark a reallocation resolved so it is not re-evaluated next pass. */
  resolveReallocation: (
    r: PendingReallocation,
    outcome: ReallocationMonitorOutcome,
  ) => Promise<void>;
  /** Surface a per-item monitor failure (mirrors the weekly audit's onDeploymentFailure);
   *  the batch continues so one failure never starves the rest. */
  onMonitorFailure?: (r: PendingReallocation, err: unknown) => void | Promise<void>;
}

/**
 * One monitor pass: for each pending reallocation, measure its guardrails, and on a breach
 * roll back to the captured prior budget. Per-item try/catch isolates failures (fleet-isolation,
 * the weekly-audit pattern). The apps/api wiring injects a real Meta-window measurement provider
 * and a rollback dispatch that goes through PlatformIngress (the governed reset_prior_budget
 * intent); this module owns only the deterministic decision + orchestration.
 */
export async function runReallocationGuardrailMonitor(
  deps: ReallocationGuardrailMonitorDeps,
): Promise<void> {
  const pending = await deps.listPendingReallocations();
  for (const r of pending) {
    try {
      const measurement = await deps.measureGuardrails(r);
      const verdict = evaluateBlastRadiusGuardrails(r.contract.guardrails, measurement.shares);
      if (!verdict.breached) {
        await deps.resolveReallocation(r, "held");
        continue;
      }
      const plan = planReallocationRollback(r.observedPriorCents, measurement.currentLiveCents);
      if (plan === null) {
        // Tripped, but observedPriorCents is unusable (non-finite/non-positive — a bad capture),
        // so there is no safe value to restore. This is NOT a clean noop: a real breach went
        // un-rolled-back, so it resolves to a DISTINCT outcome the apps/api wiring must alarm on
        // (the captured prior is the rollback's only input; losing it defeats the safety net).
        await deps.resolveReallocation(r, "rollback_unrestorable");
        continue;
      }
      if (plan.noop) {
        // Tripped, but the live budget already equals the prior — nothing to undo. Benign.
        await deps.resolveReallocation(r, "rollback_noop");
        continue;
      }
      // dispatchRollback restores observedPriorCents as an ABSOLUTE set (targetCents), so a
      // re-dispatch (e.g. if resolveReallocation below fails and the item is re-evaluated next
      // pass) is idempotent in effect; the real-dep dispatch MUST preserve set-to-absolute
      // semantics (set budget = targetCents), never "apply deltaCentsSigned to current live".
      await deps.dispatchRollback(
        r,
        { targetCents: plan.targetCents, deltaCentsSigned: plan.deltaCentsSigned },
        verdict,
      );
      await deps.resolveReallocation(r, "rolled_back");
    } catch (err) {
      await deps.onMonitorFailure?.(r, err);
    }
  }
}
