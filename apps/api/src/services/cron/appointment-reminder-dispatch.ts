import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { CreateScheduledReminderInput } from "@switchboard/core";
import { buildReminderDedupeKey } from "@switchboard/schemas";
import type { ReminderSendSubmitInput } from "../workflows/reminder-send-request.js";

const inngestClient = new Inngest({ id: "switchboard" });

const WINDOW_LOWER_MS = 23 * 60 * 60 * 1000;
const WINDOW_UPPER_MS = 25 * 60 * 60 * 1000;

export interface UpcomingBooking {
  id: string;
  organizationId: string;
  contactId: string;
  startsAt: Date;
  timezone: string;
  attendeeName: string | null;
}

export interface AppointmentReminderDispatchDeps {
  failure: AsyncFailureContext;
  findUpcomingConfirmed: (windowStart: Date, windowEnd: Date) => Promise<UpcomingBooking[]>;
  findReminderByDedupeKey: (dedupeKey: string) => Promise<{ id: string; status: string } | null>;
  createReminder: (input: CreateScheduledReminderInput) => Promise<{ id: string }>;
  submitReminderSend: (input: ReminderSendSubmitInput) => Promise<SubmitWorkResponse>;
  markSent: (id: string) => Promise<void>;
  markSkipped: (id: string, reason: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

const TERMINAL = new Set(["sent", "skipped", "failed"]);

export async function executeAppointmentReminderDispatch(
  step: StepTools,
  deps: AppointmentReminderDispatchDeps,
): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const windowStart = new Date(now.getTime() + WINDOW_LOWER_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_UPPER_MS);
  const bookings = await step.run("find-upcoming-confirmed", () =>
    deps.findUpcomingConfirmed(windowStart, windowEnd),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const b of bookings) {
    await step.run(`reminder-${b.id}-${b.startsAt.toISOString()}`, async () => {
      const dedupeKey = buildReminderDedupeKey(b.id, b.startsAt);
      const existing = await deps.findReminderByDedupeKey(dedupeKey);
      if (existing && TERMINAL.has(existing.status)) return;

      let reminderId = existing?.id;
      if (!reminderId) {
        try {
          reminderId = (
            await deps.createReminder({
              organizationId: b.organizationId,
              contactId: b.contactId,
              bookingId: b.id,
              startsAt: b.startsAt,
              timezone: b.timezone,
              channel: "whatsapp",
              templateIntentClass: "appointment-reminder",
              dedupeKey,
            })
          ).id;
        } catch (err) {
          if (isUniqueConstraintError(err)) return; // race: another tick created it
          throw err;
        }
      }

      const response = await deps.submitReminderSend({
        organizationId: b.organizationId,
        contactId: b.contactId,
        bookingId: b.id,
        startsAt: b.startsAt.toISOString(),
        timezone: b.timezone,
        channel: "whatsapp",
        reminderId,
      });

      if (!response.ok) {
        await deps.markFailed(reminderId, response.error.type);
        failed++;
        return;
      }
      const outputs = (response.result.outputs ?? {}) as { sent?: boolean; skipReason?: string };
      if (outputs.sent === true) {
        await deps.markSent(reminderId);
        sent++;
        return;
      }
      if (outputs.sent === false) {
        await deps.markSkipped(reminderId, outputs.skipReason ?? "unknown");
        skipped++;
        return;
      }
      await deps.markFailed(reminderId, "no_terminal_outcome");
      failed++;
    });
  }

  return { processed: bookings.length, sent, skipped, failed };
}

export function createAppointmentReminderDispatchCron(deps: AppointmentReminderDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "appointment-reminder-dispatch",
      name: "Appointment Reminder Dispatch",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "appointment-reminder-dispatch",
          eventDomain: "appointment-reminder",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      return executeAppointmentReminderDispatch(step as unknown as StepTools, deps);
    },
  );
}
