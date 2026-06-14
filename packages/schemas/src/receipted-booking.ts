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
 * ReceiptedBookingView at read time, not stored here. `id` is the thesis receipt_id.
 * expectedValueAtIssue is CENTS (Int), never dollars.
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
