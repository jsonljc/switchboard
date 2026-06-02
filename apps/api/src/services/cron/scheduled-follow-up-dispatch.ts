import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import { buildNextCadenceTouch, type CreateScheduledFollowUpInput } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { DueScheduledFollowUp } from "@switchboard/core";
import {
  classifyCadenceSkip,
  ACTIVATION_RETRY_INTERVAL_MS,
  ACTIVATION_MAX_OVERDUE_MS,
} from "@switchboard/schemas";

const inngestClient = new Inngest({ id: "switchboard" });

const MAX_SEND_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24h
const BASE_INTERVAL_MS = 15 * 60 * 1000; // 15m

export interface FollowUpSendSubmitInput {
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: string;
  reason: string;
  followUpId: string;
}

export type SubmitScheduledFollowUp = (
  input: FollowUpSendSubmitInput,
) => Promise<import("@switchboard/core/platform").SubmitWorkResponse>;

export interface ScheduledFollowUpDispatchDeps {
  failure: AsyncFailureContext;
  findDueFollowUps: () => Promise<DueScheduledFollowUp[]>;
  submitFollowUpSend: (input: FollowUpSendSubmitInput) => Promise<SubmitWorkResponse>;
  createFollowUp: (input: CreateScheduledFollowUpInput) => Promise<{ id: string }>;
  markSent: (id: string) => Promise<void>;
  markSkipped: (id: string, reason: string) => Promise<void>;
  markFailed: (id: string, error: string, nextRetryAt: Date | null) => Promise<void>;
  markDeferred: (id: string, reason: string, nextRetryAt: Date) => Promise<void>;
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function executeScheduledFollowUpDispatch(
  step: StepTools,
  deps: ScheduledFollowUpDispatchDeps,
): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  const due = await step.run("find-due-followups", () => deps.findDueFollowUps());

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const followUp of due) {
    await step.run(`followup-${followUp.id}`, async () => {
      const response = await deps.submitFollowUpSend({
        organizationId: followUp.organizationId,
        contactId: followUp.contactId,
        conversationThreadId: followUp.conversationThreadId,
        channel: followUp.channel,
        templateIntentClass: followUp.templateIntentClass,
        reason: followUp.reason,
        followUpId: followUp.id,
      });

      if (!response.ok) {
        const nextRetryAt = computeNextRetry(followUp.attempts, now);
        await deps.markFailed(followUp.id, response.error.type, nextRetryAt);
        failed++;
        return;
      }

      const outputs = (response.result.outputs ?? {}) as { sent?: boolean; skipReason?: string };
      if (outputs.sent === true) {
        await deps.markSent(followUp.id);
        sent++;
        const next = buildNextCadenceTouch(followUp, now());
        if (next) {
          try {
            await deps.createFollowUp(next);
          } catch (err) {
            // Same-day-bucket next touch already exists (cron-retry idempotency).
            if (!isUniqueConstraintError(err)) throw err;
          }
        }
        return;
      }
      if (outputs.sent === false) {
        const reason = outputs.skipReason ?? "unknown";
        if (classifyCadenceSkip(reason) === "activation") {
          const overdueMs = now().getTime() - followUp.dueAt.getTime();
          if (overdueMs > ACTIVATION_MAX_OVERDUE_MS) {
            await deps.markSkipped(followUp.id, "stale_unsent");
          } else {
            await deps.markDeferred(
              followUp.id,
              reason,
              new Date(now().getTime() + ACTIVATION_RETRY_INTERVAL_MS),
            );
          }
        } else {
          await deps.markSkipped(followUp.id, reason);
        }
        skipped++;
        return;
      }

      // Unexpected (no terminal sent flag) → treat as a retryable failure.
      const nextRetryAt = computeNextRetry(followUp.attempts, now);
      await deps.markFailed(followUp.id, "no_terminal_outcome", nextRetryAt);
      failed++;
    });
  }

  return { processed: due.length, sent, skipped, failed };
}

function computeNextRetry(currentAttempts: number, now: () => Date): Date | null {
  if (currentAttempts + 1 >= MAX_SEND_ATTEMPTS) return null; // terminal
  const backoffMs = Math.min(BASE_INTERVAL_MS * Math.pow(2, currentAttempts), MAX_BACKOFF_MS);
  return new Date(now().getTime() + backoffMs);
}

export function createScheduledFollowUpDispatchCron(deps: ScheduledFollowUpDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "scheduled-follow-up-dispatch",
      name: "Scheduled Follow-Up Dispatch",
      retries: 2,
      triggers: [{ cron: "*/15 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "scheduled-follow-up-dispatch",
          eventDomain: "scheduled-follow-up",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      return executeScheduledFollowUpDispatch(step as unknown as StepTools, deps);
    },
  );
}
