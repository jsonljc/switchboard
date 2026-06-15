/**
 * Frontline conversion signal for Mira's brief: which treatments the booking
 * agent (Alex) actually books, aggregated from F5's org-scoped booking-outcome
 * ledger (PrismaBookingOutcomeLedgerStore.listForOrg).
 *
 * Core stays db-free: FrontlineBookingRow is a structural subset of
 * @switchboard/db `BookingOutcomeLedgerRow`, so the Prisma store satisfies
 * FrontlineConversionLedgerReader structurally (the deploymentMemoryReader
 * pattern). Counts only, no revenue: "what converts" is booking volume per
 * service, and revenue figures stay out of the external-creative prompt.
 */
export interface FrontlineBookingRow {
  service: string;
  /** Booking lifecycle status; used to exclude failed/cancelled bookings. */
  bookingStatus: string;
}

export interface ConvertingService {
  service: string;
  bookedCount: number;
}

export interface FrontlineConversionLedgerReader {
  listForOrg(args: { orgId: string; limit: number }): Promise<FrontlineBookingRow[]>;
}

/** Recent booking outcomes fetched for the aggregation. */
export const FRONTLINE_LEDGER_LIMIT = 200;
/** Render cap: at most this many treatments named in the brief context. */
export const MAX_CONVERTING_SERVICES = 5;

/**
 * Booking statuses that are NOT conversions: a failed or cancelled booking is
 * not "what converts" and must not inflate a treatment's signal. Mirrors the
 * booking store's active-booking filter (notIn:["failed","cancelled"]) and the
 * partial unique index. (no_show lives on the separate `attendance` axis, which
 * the ledger does not carry, so it is out of reach here.)
 */
const NON_CONVERTING_BOOKING_STATUSES = new Set(["failed", "cancelled"]);

/**
 * Aggregate booking-outcome rows into the top-N treatments by booking count.
 * Failed and cancelled bookings are excluded (they are not conversions).
 * Deterministic: count desc, then service name ascending. Blank services are
 * skipped rather than forming a phantom bucket.
 */
export function summarizeConvertingServices(
  rows: readonly FrontlineBookingRow[],
  opts?: { topN?: number },
): ConvertingService[] {
  const topN = opts?.topN ?? MAX_CONVERTING_SERVICES;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const service = row.service?.trim();
    if (!service) continue;
    if (NON_CONVERTING_BOOKING_STATUSES.has(row.bookingStatus)) continue;
    counts.set(service, (counts.get(service) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([service, bookedCount]) => ({ service, bookedCount }))
    .sort((a, b) => b.bookedCount - a.bookedCount || a.service.localeCompare(b.service))
    .slice(0, topN);
}

/**
 * Render the converting-services signal as one deterministic context line for
 * Mira's prompt. Empty signal renders as "" (mirrors TASTE_CONTEXT: a section
 * that has not surfaced anything renders blank, never a fabricated number).
 */
export function renderFrontlineConversionContext(services: readonly ConvertingService[]): string {
  if (services.length === 0) return "";
  const parts = services.map((s) => `${s.service} (${s.bookedCount})`);
  return `Treatments customers actually book, most to least: ${parts.join(", ")}.`;
}
