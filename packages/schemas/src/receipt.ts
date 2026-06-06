import { z } from "zod";

export const ReceiptKindSchema = z.enum(["calendar", "payment"]);
export type ReceiptKind = z.infer<typeof ReceiptKindSchema>;

/** Strength ordering T1_FETCH_BACK > T2_PROVIDER_SIGNATURE > T3_ADMIN_AUDIT (spec §7). */
export const ReceiptTierSchema = z.enum([
  "T1_FETCH_BACK",
  "T2_PROVIDER_SIGNATURE",
  "T3_ADMIN_AUDIT",
]);
export type ReceiptTier = z.infer<typeof ReceiptTierSchema>;

/** R2: a calendar-confirmed booking is BOOKED, not HELD. */
export const ReceiptStatusSchema = z.enum(["booked", "held", "paid", "void"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

const CalendarEvidenceSchema = z.object({
  kind: z.literal("calendar"),
  basis: z.literal("calendar_confirmed"),
  calendarEventId: z.string().nullable().optional(),
});

const PaymentEvidenceSchema = z.object({
  kind: z.literal("payment"),
  basis: z.enum(["payment_verified", "payment_degraded"]),
  chargeId: z.string(),
  amountFetched: z.number().int().nonnegative(),
});

export const ReceiptEvidenceSchema = z.discriminatedUnion("kind", [
  CalendarEvidenceSchema,
  PaymentEvidenceSchema,
]);
export type ReceiptEvidence = z.infer<typeof ReceiptEvidenceSchema>;

const ReceiptBaseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  kind: ReceiptKindSchema,
  tier: ReceiptTierSchema,
  status: ReceiptStatusSchema,
  bookingId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  revenueEventId: z.string().nullable().optional(),
  connectionId: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  amount: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
  evidence: ReceiptEvidenceSchema,
  capturedBy: z.string(),
  verifiedAt: z.date().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
  createdAt: z.date(),
});

/** R2: evidence.kind must match receipt.kind (no cross-kind contamination). */
export const ReceiptSchema = ReceiptBaseSchema.superRefine((val, ctx) => {
  if (val.evidence.kind !== val.kind) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `evidence.kind '${val.evidence.kind}' must match receipt kind '${val.kind}'`,
      path: ["evidence", "kind"],
    });
  }
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Structured verdict — NEVER a bare boolean (spec §3, cross-cutting decision §11). */
export interface PaidVisitVerdict {
  paid: boolean;
  held: boolean;
  tier: ReceiptTier;
  basis: string;
  degraded: boolean;
}

export const RECEIPT_TIER_RANK: Record<ReceiptTier, number> = {
  T1_FETCH_BACK: 3,
  T2_PROVIDER_SIGNATURE: 2,
  T3_ADMIN_AUDIT: 1,
};

/**
 * R1: a Noop/Local provider fabricates its ids, so its evidence can never out-rank
 * admin-audit. Always clamp an untrusted provider's tier to T3_ADMIN_AUDIT.
 */
export function clampTierForUntrustedProvider(_requested: ReceiptTier): ReceiptTier {
  return "T3_ADMIN_AUDIT";
}
