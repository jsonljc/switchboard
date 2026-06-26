import type { WorkOutcome } from "@switchboard/core/platform";

/**
 * Classify a non-failed, non-approval {@link WorkOutcome} into the actions-route
 * result label, asserting success EXPLICITLY rather than by elimination.
 *
 * The route previously returned "EXECUTED" for anything that was not "failed" or
 * approvalRequired. But `WorkOutcome` also includes "queued" (workflow-mode defers to
 * async execution), so a deferred job read as a completed synchronous mutation — the
 * operator was told the action ran when it was only enqueued (2026-06-26 audit).
 *
 * Only "completed" is a synchronous success (EXECUTED); "queued" is async-deferred
 * (QUEUED); any other outcome is unexpected and must surface as ERROR, never a false
 * EXECUTED.
 */
export function classifySuccessOutcome(outcome: WorkOutcome): "EXECUTED" | "QUEUED" | "ERROR" {
  if (outcome === "completed") return "EXECUTED";
  if (outcome === "queued") return "QUEUED";
  return "ERROR";
}
