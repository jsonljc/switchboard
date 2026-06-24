import type { WorkOutcome } from "./types.js";
import type { WorkTrace } from "./work-trace.js";

/**
 * Enforces the platform doctrine "No mutating bypass paths" (DOCTRINE.md) at the
 * point where a WorkTrace is CONSTRUCTED.
 *
 * A WorkTrace whose `outcome` is the terminal SUCCESS value (`"completed"`)
 * asserts that a mutating action actually ran to completion. Such a record is
 * only legitimate when BOTH hold:
 *   1. governance AUTHORIZED execution — `governanceOutcome === "execute"`; and
 *   2. governance finished BEFORE execution began —
 *      `governanceCompletedAt <= executionStartedAt`.
 *
 * Anything else is a bypass: an execute-without-approval (governance denied or
 * only required approval, yet execution completed) or an approve-after-execute
 * race (execution started before — or without — governance completing). Rather
 * than persist a record that silently attests to a bypass, the recorder throws
 * so the violation surfaces loudly instead of becoming canonical history.
 *
 * Only the terminal success outcome is execution-bearing here: `"failed"` is also
 * emitted for governance denials (no execution happened), and
 * `pending_approval`/`queued`/`running` never claim a completed mutation — so the
 * guard intentionally constrains `"completed"` alone.
 *
 * SCOPE — this guard covers trace CONSTRUCTION via `buildWorkTrace`. Paths that
 * transition an already-persisted trace to a terminal outcome via
 * `WorkTraceStore.update()` — `PlatformIngress.finalizeTrace` (keyed-claim
 * finalize) and `PlatformLifecycle.executeAfterApproval` (approval resume) — do
 * NOT pass through here; they enforce the doctrine with their own gates (a
 * sealed `governanceOutcome === "execute"` claim, an `approved` envelope, and
 * `assertExecutionAdmissible`). Extending the invariant to the store's terminal
 * transition is a possible follow-up, not a gap this guard claims to close.
 *
 * CLOCK — clause 2 compares ISO-8601 UTC strings lexicographically, the same
 * monotonic-wall-clock assumption the rest of the audit layer already makes
 * (e.g. `work-trace-integrity.ts`). On the live ingress execute path
 * `governanceCompletedAt` is stamped before `executionStartedAt` by control flow
 * (with no async work between the two `Date` reads), so clause 2 holds by
 * construction; only wall-clock non-monotonicity could trip it there.
 */
const EXECUTED_OUTCOME: WorkOutcome = "completed";

export class MutatingBypassError extends Error {
  constructor(
    public readonly workUnitId: string,
    public readonly reason: string,
  ) {
    super(`WorkTrace ${workUnitId} would record a mutating bypass: ${reason}`);
    this.name = "MutatingBypassError";
  }
}

/** True for outcomes that assert a mutating action executed to terminal success. */
export function isExecutedOutcome(outcome: WorkOutcome): boolean {
  return outcome === EXECUTED_OUTCOME;
}

/**
 * Throws {@link MutatingBypassError} if `trace` records an executed outcome that
 * governance did not authorize before execution. A no-op for every non-executed
 * outcome. Pure and side-effect free — safe to call on any candidate trace.
 */
export function assertNoMutatingBypass(trace: WorkTrace): void {
  if (!isExecutedOutcome(trace.outcome)) return;

  if (trace.governanceOutcome !== "execute") {
    throw new MutatingBypassError(
      trace.workUnitId,
      `outcome "${trace.outcome}" requires governanceOutcome "execute", but got "${trace.governanceOutcome}"`,
    );
  }

  if (trace.executionStartedAt === undefined) {
    throw new MutatingBypassError(
      trace.workUnitId,
      `outcome "${trace.outcome}" requires executionStartedAt to be set`,
    );
  }

  if (trace.governanceCompletedAt > trace.executionStartedAt) {
    throw new MutatingBypassError(
      trace.workUnitId,
      `governance must complete before execution starts, but governanceCompletedAt (${trace.governanceCompletedAt}) > executionStartedAt (${trace.executionStartedAt})`,
    );
  }
}
