import { formatTimeFolio } from "./time-folio.js";

/**
 * Input row for the booking-wins projection. Structurally a superset-compatible
 * mirror of @switchboard/db `BookingOutcomeLedgerRow` (core stays db-free).
 * `value` is revenue in CENTS, null until the async `booked` ConversionRecord
 * settles. Currency formatting is a UI concern — core stays currency-neutral.
 */
export interface BookingWinSignalRow {
  traceId: string;
  deploymentId: string;
  skillSlug: string;
  bookingId: string;
  contactId: string;
  service: string;
  bookingStatus: string;
  bookedAt: Date;
  value: number | null;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  occurredAt: Date | null;
}

export interface BookingWinViewModel {
  traceId: string;
  bookingId: string;
  contactId: string;
  service: string;
  bookingStatus: string;
  valueCents: number | null;
  revenuePending: boolean;
  sourceCampaignId: string | null;
  timeFolio: string;
  occurredAtIso: string;
}

export interface BookingWinsViewModel {
  wins: readonly BookingWinViewModel[];
  hasMore: boolean;
  freshness: { generatedAt: string; dataSource: "live" };
}

const VISIBLE_LIMIT = 5;

/**
 * Pure projection of F5 booking-outcome ledger rows into the cockpit wins
 * view-model. No store/window indirection (booking-wins is a "recent" feed,
 * not a time-windowed aggregation) — the caller fetches, this formats.
 */
export function projectBookingWins(
  rows: readonly BookingWinSignalRow[],
  opts: { now: Date; timezone: string },
): BookingWinsViewModel {
  const { now, timezone } = opts;
  const visible = rows.slice(0, VISIBLE_LIMIT);
  return {
    wins: visible.map((r) => {
      // The win's effective time: when the conversion settled, else the booking.
      const effective = r.occurredAt ?? r.bookedAt;
      return {
        traceId: r.traceId,
        bookingId: r.bookingId,
        contactId: r.contactId,
        service: r.service,
        bookingStatus: r.bookingStatus,
        valueCents: r.value,
        revenuePending: r.value === null,
        sourceCampaignId: r.sourceCampaignId,
        timeFolio: formatTimeFolio(effective, now, timezone),
        occurredAtIso: effective.toISOString(),
      };
    }),
    // Best-effort: derived from the post-join rows the caller passes. The ledger
    // drops traces whose booking is absent in-org, so a caller that fetches
    // VISIBLE_LIMIT+1 traces may yield fewer rows and under-report hasMore. No
    // consumer reads this yet (no "see all" wins page — F10 surfaces inline); a
    // future wins page should compute hasMore from the trace fetch count.
    hasMore: rows.length > VISIBLE_LIMIT,
    freshness: { generatedAt: now.toISOString(), dataSource: "live" },
  };
}
