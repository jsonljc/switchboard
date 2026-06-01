import type { WorkOutcome } from "./types.js";
import type { WorkTrace } from "./work-trace.js";

/**
 * Enforces the platform doctrine "No mutating bypass paths" (DOCTRINE.md) at the
 * single point where a WorkTrace is constructed.
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
