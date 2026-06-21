import type { PdpaJurisdiction } from "@switchboard/schemas";
import { buildReceiptedBookingData } from "../../receipts/build-receipted-booking-data.js";

/** Shared P2002 (unique-constraint) classifier for the booking transaction. */
export function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

/** The narrow tx surface the issuance needs: the ReceiptedBooking writer + the contact-evidence read. */
export interface ReceiptedBookingIssuanceTx {
  receiptedBooking: {
    findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  contact: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id?: string | null;
      leadgenId?: string | null;
      sourceType?: string | null;
      firstTouchChannel?: string | null;
      pdpaJurisdiction?: string | null;
      consentGrantedAt?: Date | null;
      consentRevokedAt?: Date | null;
      phoneE164?: string | null;
      duplicateContactRisk?: boolean | null;
    } | null>;
  };
}

export interface IssueReceiptedBookingArgs {
  organizationId: string;
  bookingId: string;
  contactId: string;
  /** From the booked-conversion payload (the booking-time AttributionChain). */
  sourceAdId: string | null;
  sourceCampaignId: string | null;
  /** Snapshot of Opportunity.estimatedValue in CENTS at issuance; null when none. */
  estimatedValueCents: number | null;
  currency: string | null;
  now: Date;
}

/**
 * Issue the derived ReceiptedBooking read-model row inside the governed booking transaction (called
 * from calendar-book's confirm tx, alongside the booking confirm + receipt mint). Idempotent by
 * bookingId: findFirst-then-create, with a P2002 swallow for the (practically unreachable)
 * concurrent-retry race.
 *
 * DOCTRINE NOTE (the key reviewer decision): ReceiptedBooking is a derived read-model, not canonical
 * (Doctrine #3) and must not be able to fail the canonical booking. Under Postgres a thrown statement
 * aborts the whole tx, so a swallow-and-continue cannot isolate this write; the honest mitigation that
 * keeps it same-tx (the non-negotiable) is to make the write INFALLIBLE BY CONSTRUCTION, giving it the
 * same accepted risk profile as the receipt mint already in that tx: buildReceiptedBookingData yields a
 * fully JSON-serializable payload (no Date in the exceptions Json), every required column is set, and
 * the unique(bookingId) collision is unreachable (the booking id is freshly minted and findFirst-
 * guarded). If the row ever fails to mint it is recomputable (the lazy getView path and the revenue
 * live-value fallback both work without it).
 *
 * ATTRIBUTION SOURCE: evidence is the booking-time AttributionChain (sourceAdId / sourceCampaignId,
 * passed in) plus the contact's persisted source/consent columns (read here, org-scoped). The lazy
 * read path scores from the ConversionRecord (written downstream, absent at confirm time), so the
 * persisted snapshot is the issuance-time judgment by design. No consumer in this slice reads the
 * persisted attributionConfidence (the proof-quality tile stays lazy), so there is no drift.
 */
export async function issueReceiptedBookingInTx(
  tx: ReceiptedBookingIssuanceTx,
  args: IssueReceiptedBookingArgs,
): Promise<void> {
  const existing = await tx.receiptedBooking.findFirst({
    where: { organizationId: args.organizationId, bookingId: args.bookingId },
    select: { id: true },
  });
  if (existing) return;

  const evidenceContact = await tx.contact.findFirst({
    where: { organizationId: args.organizationId, id: args.contactId },
    select: {
      leadgenId: true,
      sourceType: true,
      firstTouchChannel: true,
      pdpaJurisdiction: true,
      consentGrantedAt: true,
      consentRevokedAt: true,
      phoneE164: true,
      duplicateContactRisk: true,
    },
  });

  // Duplicate-contact detection (issuance-time, once per booking). Two producers feed this one flag:
  // (1) the A4 lead-intake matcher persists Contact.duplicateContactRisk on an ambiguous/conflicting
  // identity (covers the email-only case the phone probe below misses), and (2) an issuance-time probe
  // for another contact sharing the canonical phoneE164 (exact, org-scoped, excluding self). They are
  // ORed: evaluateExceptions emits at most one entry and mergeExceptions de-dups by code, so no
  // double-flag. The flag is persisted into the issuance row's exceptions, carried forward on the read
  // path, and durably resolvable; it MUST be detected here, not recomputed in getView (a read-side
  // recompute would re-open an operator-RESOLVED duplicate on every read and add an N+1 probe).
  const rawPhoneE164 = evidenceContact?.phoneE164 ?? null;
  let duplicateContactRisk = evidenceContact?.duplicateContactRisk === true;
  if (!duplicateContactRisk && rawPhoneE164 && rawPhoneE164.trim().length > 0) {
    const otherWithSamePhone = await tx.contact.findFirst({
      where: {
        organizationId: args.organizationId,
        phoneE164: rawPhoneE164,
        id: { not: args.contactId },
      },
      select: { id: true },
    });
    duplicateContactRisk = otherWithSamePhone !== null;
  }

  const data = buildReceiptedBookingData({
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    evidence: {
      leadgenId: evidenceContact?.leadgenId ?? null,
      sourceAdId: args.sourceAdId,
      sourceCampaignId: args.sourceCampaignId,
      sourceType: evidenceContact?.sourceType ?? null,
      sourceChannel: evidenceContact?.firstTouchChannel ?? null,
    },
    pdpaJurisdiction: (evidenceContact?.pdpaJurisdiction ?? null) as PdpaJurisdiction | null,
    consentGrantedAt: evidenceContact?.consentGrantedAt ?? null,
    consentRevokedAt: evidenceContact?.consentRevokedAt ?? null,
    estimatedValueCents: args.estimatedValueCents,
    currency: args.currency,
    duplicateContactRisk,
    now: args.now,
  });
  try {
    await tx.receiptedBooking.create({ data: data as unknown as Record<string, unknown> });
  } catch (err) {
    // Concurrent issuance won the unique(bookingId) race: the row exists, so this is an idempotent
    // no-op. Any other error propagates (and rolls back the booking, consistent with the receipt mint).
    if (!isPrismaUniqueConstraintError(err)) throw err;
  }
}
