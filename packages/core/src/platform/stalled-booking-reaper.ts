import type { Counter } from "../telemetry/metrics.js";
import type {
  OperatorAlerter,
  InfrastructureFailureAlert,
} from "../observability/operator-alerter.js";
import { safeAlert } from "../observability/operator-alerter.js";

/**
 * A8b-2 / rank-18 - Stalled `pending_confirmation` booking reaper.
 *
 * `PrismaBookingStore.create` persists a booking as `pending_confirmation` BEFORE the external
 * calendar mutation, and the slot-overlap predicate counts that row as occupying (status notIn
 * [failed, cancelled]). The only writers that terminalize the row are confirm() -> confirmed,
 * markFailed() -> failed, and the calendar-book failure handler. If that terminalizing write is
 * lost - the failure-handler tx throws, or the process dies between create() and a terminal
 * write - the row is stranded `pending_confirmation` and PERMANENTLY blocks its physical slot
 * (every future create() throws BookingSlotConflictError), silently (no metric, no reaper).
 *
 * This bounded sweep ages such a row to the existing terminal `failed` (already excluded from
 * every active/overlap predicate, so the slot releases and reporting stays correct with no new
 * status), emits a counter per reaped row, and raises ONE operator alert per run. It is the same
 * failure class as the stranded idempotency-claim reaper (a process death / throw between a
 * pre-write and its terminalization) and mirrors its shape.
 */

/** The narrow store slice the reaper needs. PrismaBookingStore satisfies it structurally. */
export interface StalledBookingReaperStore {
  findStalledPending(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; organizationId: string; createdAt: Date }>>;
  /** Status-guarded CAS: count 1 = reaped, count 0 = a concurrent confirm/fail already moved it. */
  reapStalledPending(organizationId: string, bookingId: string): Promise<{ count: number }>;
}

export interface StalledPendingBooking {
  id: string;
  organizationId: string;
  createdAt: Date;
}

export interface ReapStalledBookingsDeps {
  store: StalledBookingReaperStore;
  /** `bookingStalledReaped` - incremented once per row actually aged to failed, labeled by orgId. */
  counter: Counter;
  /** Fired ONCE per run (when >=1 stale booking is found) - no per-row alert storm. */
  alerter: OperatorAlerter;
  /** Injectable clock for tests; defaults to wall clock. */
  now?: () => Date;
}

export interface ReapStalledBookingsConfig {
  /** Age threshold: only pending bookings created before (now - this) are reaped. */
  olderThanMs: number;
  /** Upper bound on rows scanned/aged per run. */
  limit: number;
}

export interface ReapStalledBookingsResult {
  /** Stale pending bookings found this run. */
  scanned: number;
  /** Bookings successfully aged to failed (slot released). */
  reaped: number;
  /** Bookings a concurrent confirm/fail terminalized between scan and our CAS (count 0). Benign. */
  raced: number;
  /** Bookings whose reap-write THREW (a hard store error) - left for the next run; the alarm case. */
  failed: number;
}

/**
 * 30 minutes - far above any legitimate pending window. A booking resolves
 * pending_confirmation -> confirmed/failed within ONE synchronous tool invocation (the provider
 * call is seconds); there is no async-park path that legitimately holds a booking pending. A
 * row still pending after this is stranded. Even a falsely-reaped slow confirm resolves in the
 * SAFE direction (slot released; row terminalized to failed).
 */
export const STALLED_BOOKING_MAX_AGE_MS = 30 * 60 * 1000;

/** Bounded batch per run - the reaper never fans out unbounded on a mass strand. */
export const STALLED_BOOKING_REAP_LIMIT = 500;

export async function reapStalledBookings(
  deps: ReapStalledBookingsDeps,
  config: ReapStalledBookingsConfig,
): Promise<ReapStalledBookingsResult> {
  const now = deps.now?.() ?? new Date();
  const olderThan = new Date(now.getTime() - config.olderThanMs);

  const stuck = await deps.store.findStalledPending(olderThan, config.limit);
  let reaped = 0;
  let raced = 0;
  let failed = 0;

  for (const booking of stuck) {
    try {
      const { count } = await deps.store.reapStalledPending(booking.organizationId, booking.id);
      if (count === 0) {
        // A concurrent confirm()/markFailed() moved the row between our scan and CAS. The row is
        // now properly terminal; nothing to do and NOT an alarm. Count as a benign race.
        raced++;
        console.warn(
          `[stalled-booking-reaper] bookingId=${booking.id} org=${booking.organizationId} ` +
            `was already terminalized by a concurrent confirm/fail; skipping`,
        );
        continue;
      }
      reaped++;
      deps.counter.inc({ orgId: booking.organizationId });
      // Per-row forensics so each released slot is in logs (the alert is a summary).
      console.warn(
        `[stalled-booking-reaper] reaped stalled pending_confirmation booking bookingId=${booking.id} ` +
          `org=${booking.organizationId} createdAt=${booking.createdAt.toISOString()} -> failed (slot released)`,
      );
    } catch (err) {
      failed++;
      console.error(
        `[stalled-booking-reaper] reap threw for bookingId=${booking.id} ` +
          `org=${booking.organizationId}; left for next run`,
        err,
      );
    }
  }

  // ONE summary alert per run when ANY stale booking was found - never silent, never a per-row
  // storm. Only a HARD reap-write error (a throw) escalates to critical; a benign concurrent-seal
  // race does not (the row resolved).
  if (stuck.length > 0) {
    const capped = stuck.length >= config.limit;
    const cappedNote = capped
      ? ` Result CAPPED at the ${config.limit}-row scan limit; more stalled bookings likely remain and the next run will continue.`
      : "";
    const alert: InfrastructureFailureAlert = {
      errorType: "stalled_booking_reaped",
      severity: failed > 0 ? "critical" : "warning",
      errorMessage:
        `Found ${stuck.length} stalled pending_confirmation booking(s); reaped ${reaped} to failed ` +
        `(slot released), ${raced} already-terminalized by a concurrent confirm/fail, ` +
        `${failed} hard reap-write error(s).${cappedNote}`,
      retryable: false,
      occurredAt: now.toISOString(),
      source: "inngest_function",
    };
    await safeAlert(deps.alerter, alert);
  }

  return { scanned: stuck.length, reaped, raced, failed };
}
