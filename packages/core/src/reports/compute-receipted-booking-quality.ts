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

/** Exception codes that do NOT signal an unresolved owner action item, so they must not inflate
 *  `bookingsNeedingAttention`. `manual_override` means the owner has already asserted attribution;
 *  it stays in the per-code breakdown and on the worklist row (so the assertion is visible/undoable),
 *  but a booking whose ONLY open code is `manual_override` is settled, not "needing attention". */
const NON_ATTENTION_CODES: ReadonlySet<ExceptionCode> = new Set(["manual_override"]);

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
 * worklist row and `bookingsNeedingAttention` are computed from the SAME per-view open-code set, with
 * `bookingsNeedingAttention` additionally filtered through NON_ATTENTION_CODES: a booking whose only
 * open code is settled (e.g. `manual_override`, already resolved by the owner) stays on the worklist
 * and in the per-code breakdown but is OFF the headline count, so overriding a booking actually moves
 * the number. The Record initializers are keyed by the canonical enums, so a new rung or exception
 * code is a compile-time error here rather than a silently dropped bucket.
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
    // One open-code set per view drives the per-code counts, the worklist row, AND (filtered through
    // NON_ATTENTION_CODES) bookingsNeedingAttention, so a worklist row and its attention contribution
    // are always derived from the same source. Resolved entries excluded; a booking's open exceptions
    // are deduped by code so each code counts the booking once.
    const openCodes = new Set(
      view.exceptions.filter((entry) => !entry.resolvedAt).map((entry) => entry.code),
    );
    if (openCodes.size === 0) continue;
    // Settled codes (e.g. manual_override) stay on the worklist + breakdown but do not signal an
    // open action item: a booking counts toward attention only if it has a non-settled open code.
    let needsAttention = false;
    for (const code of openCodes) {
      exceptions[code] += 1;
      if (!NON_ATTENTION_CODES.has(code)) needsAttention = true;
    }
    if (needsAttention) bookingsNeedingAttention += 1;
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
