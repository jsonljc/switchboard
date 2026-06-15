import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type {
  AttributionConfidence,
  ExceptionCode,
  ReceiptedBookingQualityData,
  ReceiptedBookingWorklistItem,
} from "@switchboard/schemas";

/** Worst-first severity rank: weaker attribution sorts higher (toward the top of the worklist).
 *  A literal Record over the enum, so a new rung is a compile error here, never a silent NaN. */
const CONFIDENCE_RANK: Record<AttributionConfidence, number> = {
  unattributed: 4,
  low: 3,
  medium: 2,
  high: 1,
  deterministic: 0,
};

/** Canonical exception-code order for a booking's worklist codes (matches the taxonomy enum), so a
 *  row's `openExceptionCodes` is stable and presentation order is deterministic, not Set-insertion. */
const EXCEPTION_ORDER: readonly ExceptionCode[] = [
  "missing_source",
  "missing_consent",
  "manual_override",
  "duplicate_contact_risk",
];

/** Max worklist rows carried in the (cached) report payload. The cap is NOT silent: the consumer
 *  shows "N of {bookingsNeedingAttention}", so the true total is always visible to the owner. */
const WORKLIST_CAP = 25;

/** Worst-first comparator: more open codes, then weaker attribution, then oldest appointment
 *  (ISO strings sort chronologically under lexicographic compare), then bookingId for stability. */
function compareWorklist(a: ReceiptedBookingWorklistItem, b: ReceiptedBookingWorklistItem): number {
  if (a.openExceptionCodes.length !== b.openExceptionCodes.length) {
    return b.openExceptionCodes.length - a.openExceptionCodes.length;
  }
  const rankDelta =
    CONFIDENCE_RANK[b.attributionConfidence] - CONFIDENCE_RANK[a.attributionConfidence];
  if (rankDelta !== 0) return rankDelta;
  if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
  return a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0;
}

/**
 * Roll the receipted-booking read-projection (spec slice 4) up into a proof-quality summary for the
 * owner report: how many receipted bookings sit at each attribution-confidence rung, how many carry
 * each open exception code, and the per-booking WORKLIST behind `bookingsNeedingAttention` (the
 * specific bookings the owner can act on, worst-first, capped). Consumes `receiptedBookings.listForCohort`
 * (the same distinct booked|held calendar-receipt cohort as the north-star count), so `cohortSize`
 * matches `receiptedBookings.count` except for orphaned cohort rows the store filters out.
 *
 * Pure aggregation: `attributionConfidence` and `exceptions` were already derived per booking by the
 * store via the pure `core/receipts` functions, so this never re-implements scoring (no drift). The
 * worklist row and `bookingsNeedingAttention` are computed from the SAME open-code set per view, so
 * they can never disagree. The Record initializers are keyed by the canonical enums, so a new rung
 * or exception code is a compile-time error here rather than a silently dropped bucket.
 */
export async function computeReceiptedBookingQuality(
  ctx: RollupContext,
  receiptedBookings: ReportStores["receiptedBookings"],
): Promise<ReceiptedBookingQualityData> {
  const views = await receiptedBookings.listForCohort({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
  });

  const confidence: Record<AttributionConfidence, number> = {
    deterministic: 0,
    high: 0,
    medium: 0,
    low: 0,
    unattributed: 0,
  };
  const exceptions: Record<ExceptionCode, number> = {
    missing_source: 0,
    missing_consent: 0,
    manual_override: 0,
    duplicate_contact_risk: 0,
  };
  let bookingsNeedingAttention = 0;
  const worklist: ReceiptedBookingWorklistItem[] = [];

  for (const view of views) {
    confidence[view.attributionConfidence] += 1;
    // One open-code set per view drives bookingsNeedingAttention, the per-code counts, AND the
    // worklist row, so the count and the list can never diverge. Resolved entries excluded; a
    // booking's open exceptions are deduped by code so each code counts the booking once.
    const openCodes = new Set(
      view.exceptions.filter((entry) => !entry.resolvedAt).map((entry) => entry.code),
    );
    if (openCodes.size === 0) continue;
    bookingsNeedingAttention += 1;
    for (const code of openCodes) {
      exceptions[code] += 1;
    }
    worklist.push({
      bookingId: view.bookingId,
      service: view.service,
      startsAt: view.startsAt.toISOString(),
      attributionConfidence: view.attributionConfidence,
      openExceptionCodes: EXCEPTION_ORDER.filter((code) => openCodes.has(code)),
      issuedAt: view.issuedAt != null ? view.issuedAt.toISOString() : null,
      overridden: view.overriddenBy != null,
    });
  }

  worklist.sort(compareWorklist);

  return {
    cohortSize: views.length,
    confidence,
    exceptions,
    bookingsNeedingAttention,
    worklist: worklist.slice(0, WORKLIST_CAP),
  };
}
