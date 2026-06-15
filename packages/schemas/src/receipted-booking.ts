import { z } from "zod";

/**
 * Attribution-confidence ladder (revenue-proof direction, Ledger spec). Ordered strongest to
 * weakest. "unattributed" still counts as a receipted booking; it raises a missing_source
 * exception rather than dropping the booking.
 */
export const AttributionConfidenceSchema = z.enum([
  "deterministic",
  "high",
  "medium",
  "low",
  "unattributed",
]);
export type AttributionConfidence = z.infer<typeof AttributionConfidenceSchema>;

/** Reasons a receipted booking is flagged. Resolved by stamping resolvedAt, never by deletion. */
export const ExceptionCodeSchema = z.enum([
  "missing_source",
  "missing_consent",
  "manual_override",
  "duplicate_contact_risk",
]);
export type ExceptionCode = z.infer<typeof ExceptionCodeSchema>;

export const ExceptionEntrySchema = z.object({
  code: ExceptionCodeSchema,
  detail: z.string().optional(),
  raisedAt: z.date(),
  resolvedAt: z.date().nullable().optional(),
});
export type ExceptionEntry = z.infer<typeof ExceptionEntrySchema>;

/**
 * The persisted ReceiptedBooking row: the derived + snapshot fields only. Live fields
 * (attendance, payment, consent, trace, current source evidence) are joined into the
 * ReceiptedBookingView at read time, not stored here. `id` is this aggregate's own id, NOT
 * the proof-object id: the thesis receipt_id resolves to the linked `Receipt` row(s) by join
 * (Receipt stays the proof primitive). expectedValueAtIssue is CENTS (Int), never dollars.
 */
export const ReceiptedBookingSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  bookingId: z.string(),
  issuedAt: z.date(),
  attributionConfidence: AttributionConfidenceSchema,
  attributionUpdatedAt: z.date(),
  expectedValueAtIssue: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().nullable().optional(),
  exceptions: z.array(ExceptionEntrySchema),
  overriddenBy: z.string().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overriddenAt: z.date().nullable().optional(),
  lastEvaluatedAt: z.date(),
  createdAt: z.date(),
});
export type ReceiptedBooking = z.infer<typeof ReceiptedBookingSchema>;

/** A minimal reference to a proof Receipt row; the thesis receipt_id resolves to Receipt.id by join. */
export const ReceiptRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
});
export type ReceiptRef = z.infer<typeof ReceiptRefSchema>;

/**
 * The attribution evidence used to score a booking (Contact + ConversionRecord fields). Mirrors
 * core's AttributionEvidence, redeclared here because schemas (Layer 1) cannot import core (Layer 3).
 */
export const SourceEvidenceSchema = z.object({
  leadgenId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  sourceChannel: z.string().nullable().optional(),
});
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;

/**
 * The full assembled receipted-booking view: identity + the two derived judgments
 * (attributionConfidence + exceptions, computed lazily via scoreAttribution / evaluateExceptions)
 * + joined live evidence resolved at read time. `matchedPolicies` carries WorkTrace.matchedPolicies
 * (the embedded policy-evidence JSON that is the thesis policy_check_id ground truth, "partial
 * (embedded)" per the spec), null when the booking has no trace. Persisted-snapshot fields
 * (issuedAt, expectedValueAtIssue, override provenance) are optional: null/omitted in the lazy read
 * path, populated once the deferred issuance write-path ships.
 */
export const ReceiptedBookingViewSchema = z.object({
  bookingId: z.string(),
  organizationId: z.string(),
  attributionConfidence: AttributionConfidenceSchema,
  exceptions: z.array(ExceptionEntrySchema),
  receipts: z.array(ReceiptRefSchema),
  contactKey: z.string().nullable(),
  consentGrantedAt: z.date().nullable(),
  consentRevokedAt: z.date().nullable(),
  sourceEvidence: SourceEvidenceSchema,
  traceId: z.string().nullable(),
  matchedPolicies: z.string().nullable(),
  humanApprovalId: z.string().nullable(),
  attendanceState: z.string().nullable(),
  paymentEventIds: z.array(z.string()),
  expectedValue: z.number().int().nullable(),
  issuedAt: z.date().nullable().optional(),
  expectedValueAtIssue: z.number().int().nonnegative().nullable().optional(),
  overriddenBy: z.string().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overriddenAt: z.date().nullable().optional(),
});
export type ReceiptedBookingView = z.infer<typeof ReceiptedBookingViewSchema>;
