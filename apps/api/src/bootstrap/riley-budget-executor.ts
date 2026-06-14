import type { WorkflowHandler } from "@switchboard/core/platform";
import { RILEY_REALLOCATE_INTENT } from "../services/workflows/riley-budget-submit-request.js";

/**
 * SPEC-1B PR 1B-1.2 placeholder reallocate executor. The governed scaffold (intent registration +
 * seeded mandatory policy + submitter) is real and PARKS an approved reallocation for a human; the
 * EXECUTION is deliberately not wired yet. This handler FAILS CLOSED (outcome:"failed",
 * EXECUTOR_NOT_WIRED), NEVER returns "completed", and NEVER touches Meta (no ads client is in scope)
 * - so no terminal completed lifecycle can be cached and replayed as a phantom success before the
 * real read-modify-re-read executor (blast-radius cap + drift check + ExecutionReceipt) lands in PR
 * 1B-1.5.
 */
export function buildRileyBudgetExecutorHandler(): { intent: string; handler: WorkflowHandler } {
  return {
    intent: RILEY_REALLOCATE_INTENT,
    handler: {
      async execute() {
        return {
          outcome: "failed" as const,
          summary: "Reallocation executor not wired yet; refusing to act.",
          error: {
            code: "EXECUTOR_NOT_WIRED",
            message:
              "adoptimizer.campaign.reallocate reached the placeholder executor. The real " +
              "read-modify-re-read executor (blast-radius cap, drift check, ExecutionReceipt) ships in " +
              "Spec-1B PR 1B-1.5; until then an approved reallocation fails closed and never touches Meta.",
          },
        };
      },
    },
  };
}
