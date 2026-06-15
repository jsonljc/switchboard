import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type {
  AttributionConfidence,
  ExceptionCode,
  ReceiptedBookingQualityData,
} from "@switchboard/schemas";

/**
 * Roll the receipted-booking read-projection (spec slice 4) up into a proof-quality summary for the
 * owner report: how many receipted bookings sit at each attribution-confidence rung, and how many
 * carry each open exception code (the worklist). Consumes `receiptedBookings.listForCohort` — the
 * same distinct booked|held calendar-receipt cohort as the north-star count — so `cohortSize` always
 * equals `receiptedBookings.count`.
 *
 * Pure aggregation: `attributionConfidence` and `exceptions` were already derived per booking by the
 * store via the pure `core/receipts` functions, so this never re-implements scoring (no drift). The
 * Record initializers are keyed by the canonical enums, so a new rung or exception code is a
 * compile-time error here rather than a silently dropped bucket.
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

  for (const view of views) {
    confidence[view.attributionConfidence] += 1;
    const open = view.exceptions.filter((entry) => !entry.resolvedAt);
    if (open.length > 0) bookingsNeedingAttention += 1;
    for (const entry of open) {
      exceptions[entry.code] += 1;
    }
  }

  return { cohortSize: views.length, confidence, exceptions, bookingsNeedingAttention };
}
