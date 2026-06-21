import type { AttributionConfidence, ExceptionCode, PdpaJurisdiction } from "@switchboard/schemas";
import { scoreAttribution, type AttributionEvidence } from "./score-attribution.js";
import { evaluateExceptions } from "./evaluate-exceptions.js";

/** A JSON-native exception entry for the Prisma `Json` column (dates as ISO strings, never Date). */
export interface SerializedExceptionEntry {
  code: ExceptionCode;
  detail?: string;
  raisedAt: string;
  resolvedAt: string | null;
}

/**
 * The `data` payload for `tx.receiptedBooking.create`. The DateTime columns (issuedAt /
 * attributionUpdatedAt / lastEvaluatedAt) take Date; the `exceptions` Json column takes JSON-native
 * entries. attributionConfidence + exceptions are the derived issuance judgment; re-evaluation is a
 * deferred, separate concern (this row is the stable snapshot, not a live re-computed value).
 */
export interface ReceiptedBookingRowData {
  organizationId: string;
  bookingId: string;
  issuedAt: Date;
  attributionConfidence: AttributionConfidence;
  attributionUpdatedAt: Date;
  expectedValueAtIssue: number | null;
  currency: string | null;
  exceptions: SerializedExceptionEntry[];
  lastEvaluatedAt: Date;
}

export interface BuildReceiptedBookingArgs {
  organizationId: string;
  bookingId: string;
  evidence: AttributionEvidence;
  /** Contact.pdpaJurisdiction. Null = PDPA not_applicable -> missing_consent is not raised. */
  pdpaJurisdiction?: PdpaJurisdiction | null;
  consentGrantedAt?: Date | null;
  consentRevokedAt?: Date | null;
  /** Snapshot of Opportunity.estimatedValue in CENTS at issuance; null when no opportunity/estimate. */
  estimatedValueCents?: number | null;
  currency?: string | null;
  /**
   * True when another contact in the org shares this contact's non-null phoneE164 (identity ambiguity).
   * The issuance caller computes it from a real org-scoped probe; the read path keeps it false and
   * sources duplicate_contact_risk from the persisted carry, so an operator resolve stays durable.
   */
  duplicateContactRisk?: boolean;
  now: Date;
}

/**
 * NaN-safe cents snapshot: a finite, nonnegative value rounded to whole cents, else null. A null
 * snapshot still counts toward the booking COUNT but is excluded from the revenue SUM (spec §4).
 */
export function snapshotCents(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/**
 * Build the persisted ReceiptedBooking issuance row from booking-time evidence. Pure; mirrors
 * `buildCalendarReceiptData`. Reuses the pure `scoreAttribution` / `evaluateExceptions` so issuance
 * never re-implements scoring (no drift). Exception dates are serialized to ISO strings for the Json
 * column, so the resulting payload is fully JSON-serializable, which is what makes the same-tx write
 * infallible-by-construction (it cannot raise a Prisma Json-validation error that rolls back the
 * canonical booking). The caller persists it inside the governed booking transaction (idempotent by
 * bookingId).
 */
export function buildReceiptedBookingData(
  args: BuildReceiptedBookingArgs,
): ReceiptedBookingRowData {
  const attributionConfidence = scoreAttribution(args.evidence);
  const exceptions: SerializedExceptionEntry[] = evaluateExceptions({
    attributionConfidence,
    pdpaJurisdiction: args.pdpaJurisdiction ?? null,
    consentGrantedAt: args.consentGrantedAt ?? null,
    consentRevokedAt: args.consentRevokedAt ?? null,
    overriddenBy: null,
    duplicateContactRisk: args.duplicateContactRisk ?? false,
    now: args.now,
  }).map((e) => ({
    code: e.code,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    raisedAt: e.raisedAt.toISOString(),
    resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
  }));
  return {
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    issuedAt: args.now,
    attributionConfidence,
    attributionUpdatedAt: args.now,
    expectedValueAtIssue: snapshotCents(args.estimatedValueCents),
    currency: args.currency ?? null,
    exceptions,
    lastEvaluatedAt: args.now,
  };
}
