import { Inngest } from "inngest";
import { makeOnFailureHandler, safeAlert, type AsyncFailureContext } from "@switchboard/core";
import type { DueRobinRecoverySend } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import {
  ROBIN_RECOVERY_RETRY_INTENT,
  type RecoveryRetrySubmitInput,
} from "../workflows/robin-recovery-request.js";

const inngestClient = new Inngest({ id: "switchboard" });

const RETRY_BATCH_LIMIT = 200;
const DEAD_LETTER_ALERT_MIN = 3;
const DEAD_LETTER_ALERT_RATIO = 0.5;

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface RobinRecoveryRetryDispatchDeps {
  failure: AsyncFailureContext;
  findDueRetries: (now: Date, limit: number) => Promise<DueRobinRecoverySend[]>;
  submitRecoveryRetry: (input: RecoveryRetrySubmitInput) => Promise<SubmitWorkResponse>;
  now?: () => Date;
}

export interface RobinRecoveryRetryDispatchResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  deadLettered: number;
}

export async function executeRobinRecoveryRetryDispatch(
  step: StepTools,
  deps: RobinRecoveryRetryDispatchDeps,
): Promise<RobinRecoveryRetryDispatchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await step.run("find-due-recovery-retries", () =>
    deps.findDueRetries(now, RETRY_BATCH_LIMIT),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of due) {
    await step.run(`recovery-retry-${row.id}`, async () => {
      const res = await deps.submitRecoveryRetry({
        organizationId: row.organizationId,
        rowId: row.id,
        contactId: row.contactId,
        bookingId: row.bookingId,
        campaignKind: row.campaignKind,
        attempts: row.attempts,
      });

      if ("approvalRequired" in res && res.approvalRequired) {
        // Defensive: retry must auto-execute; a park = misconfig, never a silent send.
        skipped++;
        return;
      }

      if (!res.ok) {
        if (res.error.type === "idempotency_in_flight") {
          skipped++;
          return;
        }
        failed++;
        return;
      }

      const outputs = (res.result.outputs ?? {}) as { outcome?: string; deadLettered?: boolean };
      if (outputs.outcome === "sent") {
        sent++;
      } else if (outputs.outcome === "skipped") {
        skipped++;
      } else {
        failed++;
        if (outputs.deadLettered === true) {
          deadLettered++;
        }
      }
    });
  }

  // NaN-safe dead-letter ratio alert — only fires when batch is large enough to be meaningful.
  if (
    deadLettered > 0 &&
    due.length >= DEAD_LETTER_ALERT_MIN &&
    deadLettered / due.length >= DEAD_LETTER_ALERT_RATIO
  ) {
    await safeAlert(deps.failure.operatorAlerter, {
      errorType: "async_job_retry_exhausted",
      severity: "warning",
      errorMessage: `${deadLettered}/${due.length} Robin recovery sends dead-lettered after exhausting bounded retries`,
      intent: ROBIN_RECOVERY_RETRY_INTENT,
      retryable: false,
      occurredAt: now.toISOString(),
      source: "inngest_function",
    });
  }

  return { processed: due.length, sent, skipped, failed, deadLettered };
}

export function createRobinRecoveryRetryDispatchCron(deps: RobinRecoveryRetryDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "robin-recovery-retry-dispatch",
      name: "Robin No-Show Recovery Retry Dispatch",
      retries: 2,
      triggers: [{ cron: "*/15 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "robin-recovery-retry-dispatch",
          eventDomain: "robin-recovery",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => executeRobinRecoveryRetryDispatch(step as unknown as StepTools, deps),
  );
}
