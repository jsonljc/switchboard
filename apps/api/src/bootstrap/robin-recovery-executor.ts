import type { WorkflowHandler } from "@switchboard/core/platform";
import { ROBIN_RECOVERY_SEND_INTENT } from "../services/workflows/robin-recovery-request.js";

/**
 * Placeholder executor for robin.recovery_campaign.send. This slice ARMS the governed path (intent
 * + seeded require_approval policy + deployment resolution), proven to PARK; the live consent-gated
 * WhatsApp send lands in a later slice. Fail-closed, mirroring Riley's reallocate EXECUTOR_NOT_WIRED
 * first-slice placeholder: on the not-yet-reachable approve+dispatch it records a loud failure
 * rather than silently "completing" a campaign that sent nothing. No prod path submits this intent
 * yet (the cron lands with the send), so this runs only under test.
 */
export function buildRobinRecoverySendExecutor(): { intent: string; handler: WorkflowHandler } {
  return {
    intent: ROBIN_RECOVERY_SEND_INTENT,
    handler: {
      async execute() {
        return {
          outcome: "failed" as const,
          summary:
            "Robin recovery send is not wired yet; the consent-gated send lands in a later slice.",
          error: {
            code: "ROBIN_RECOVERY_SEND_NOT_WIRED",
            message:
              "robin.recovery_campaign.send dispatch is deferred to the consent-gated send slice.",
          },
        };
      },
    },
  };
}
