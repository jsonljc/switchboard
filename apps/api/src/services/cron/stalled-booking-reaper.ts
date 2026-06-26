// apps/api/src/services/cron/stalled-booking-reaper.ts
// ---------------------------------------------------------------------------
// A8b-2 / rank-18 - stalled pending_confirmation booking reaper (Inngest cron)
// ---------------------------------------------------------------------------
// Hourly sweep that ages bookings stranded in `pending_confirmation` (a thrown
// failure-handler tx or a process death between create() and a terminal write)
// to the terminal `failed` status, releasing the physical slot they otherwise
// block forever. Emits a per-row counter and ONE operator alert per run. The
// aging logic lives in the core `reapStalledBookings` orchestrator; this file is
// the thin Inngest wiring. Idempotent across retries - an already-reaped row is
// `failed`, not `pending_confirmation`, so findStalledPending will not return it.
// ---------------------------------------------------------------------------

import {
  makeOnFailureHandler,
  type AsyncFailureContext,
  type OperatorAlerter,
  type Counter,
} from "@switchboard/core";
import {
  reapStalledBookings,
  STALLED_BOOKING_MAX_AGE_MS,
  STALLED_BOOKING_REAP_LIMIT,
  type StalledBookingReaperStore,
  type ReapStalledBookingsResult,
} from "@switchboard/core/platform";
import { inngestClient } from "@switchboard/creative-pipeline";

export interface StalledBookingReaperCronDeps {
  failure: AsyncFailureContext;
  /**
   * The booking store (PrismaBookingStore satisfies the narrow reaper slice). Null when no
   * Postgres-backed store is wired - the cron then no-ops, never fabricating a reaper run.
   */
  store: StalledBookingReaperStore | null;
  alerter: OperatorAlerter;
  /** `bookingStalledReaped` from the active metrics registry. */
  counter: Counter;
  /** Defaults to STALLED_BOOKING_MAX_AGE_MS. */
  olderThanMs?: number;
  /** Defaults to STALLED_BOOKING_REAP_LIMIT. */
  limit?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export type StalledBookingReaperResult = ReapStalledBookingsResult & { skipped?: boolean };

export async function executeStalledBookingReaper(
  step: StepTools,
  deps: StalledBookingReaperCronDeps,
): Promise<StalledBookingReaperResult> {
  const store = deps.store;
  if (!store) {
    // No store wired (no Postgres) - nothing to reap. Never alert.
    return { scanned: 0, reaped: 0, raced: 0, failed: 0, skipped: true };
  }
  return step.run("reap-stalled-bookings", () =>
    reapStalledBookings(
      { store, counter: deps.counter, alerter: deps.alerter, now: deps.now },
      {
        olderThanMs: deps.olderThanMs ?? STALLED_BOOKING_MAX_AGE_MS,
        limit: deps.limit ?? STALLED_BOOKING_REAP_LIMIT,
      },
    ),
  );
}

export function createStalledBookingReaperCron(deps: StalledBookingReaperCronDeps) {
  return inngestClient.createFunction(
    {
      id: "stalled-booking-reaper-hourly",
      name: "Stalled Booking Reaper",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "stalled-booking-reaper-hourly",
          eventDomain: "stalled-booking-reaper",
          // A reaper run failing means stalled bookings keep blocking slots silently - alert.
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => executeStalledBookingReaper(step as unknown as StepTools, deps),
  );
}
