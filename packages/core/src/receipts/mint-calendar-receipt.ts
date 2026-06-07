import {
  clampTierForUntrustedProvider,
  type ReceiptTier,
  type ReceiptEvidence,
} from "@switchboard/schemas";

export interface BuildCalendarReceiptArgs {
  bookingId: string;
  organizationId: string;
  opportunityId?: string | null;
  workTraceId?: string | null;
  calendarEventId?: string | null;
  /** false for Noop/Local providers that fabricate ids (R1). */
  providerTrusted: boolean;
  requestedTier: ReceiptTier;
  isProduction: boolean;
}

export interface CalendarReceiptData {
  kind: "calendar";
  status: "booked";
  tier: ReceiptTier;
  organizationId: string;
  bookingId: string;
  opportunityId: string | null;
  workTraceId: string | null;
  capturedBy: string;
  evidence: ReceiptEvidence;
}

/**
 * R2: a calendar-confirmed booking is BOOKED, not HELD.
 * R1: an untrusted (Noop/Local) provider can never mint above T3 — clamp regardless
 * of env; the prod-assert test pins isProduction=true explicitly.
 */
export function buildCalendarReceiptData(args: BuildCalendarReceiptArgs): CalendarReceiptData {
  const tier = args.providerTrusted
    ? args.requestedTier
    : clampTierForUntrustedProvider(args.requestedTier);
  return {
    kind: "calendar",
    status: "booked",
    tier,
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    opportunityId: args.opportunityId ?? null,
    workTraceId: args.workTraceId ?? null,
    capturedBy: "calendar-book",
    // 1A note: calendar receipts intentionally carry no externalRef, so the
    // (organizationId, kind, externalRef) partial-unique does not dedupe them and a
    // confirm-failure + same-slot retry can mint a second `booked` receipt. Harmless
    // in the prove leg (no receipt-counting consumer). Before 1B consumes receipts,
    // populate externalRef from calendarEventId — that is also the T1_FETCH_BACK
    // verification key — so the partial-unique dedupes (handle the resulting P2002).
    evidence: {
      kind: "calendar",
      basis: "calendar_confirmed",
      calendarEventId: args.calendarEventId ?? null,
    },
  };
}
