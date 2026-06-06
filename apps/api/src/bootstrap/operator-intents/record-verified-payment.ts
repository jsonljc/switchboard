// apps/api/src/bootstrap/operator-intents/record-verified-payment.ts
// ---------------------------------------------------------------------------
// payment.record_verified handler factory (spec 1A-4b, architecture A).
// In ONE runInTransaction writes:
//   1. a payment Receipt (1A-3 primitive: kind=payment, status=paid, evidence
//      kind=payment) whose tier/verified/degraded are derived from the provider
//      (R1 honest degradation: noop -> T3, never verified; real PSP -> T1);
//   2. a LifecycleRevenueEvent(type=deposit, bookingId, verified) welded to the
//      booking — record() short-circuits a duplicate externalReference;
//   3. a `purchased` OutboxEvent whose eventId derives from the revenue row id,
//      so a replay re-issues the SAME id and the outbox unique no-ops it.
// Authority is the external PSP fetch-back, so this intent is system_auto_
// approved; operator.record_revenue stays separate (verified=false).
// R2: this is a PAYMENT receipt (status=paid) — the paid signal is the verified
// payment, never a calendar-only receipt.
// ---------------------------------------------------------------------------
import type { RevenueStore, StoreTransactionContext, MintReceiptInput } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordVerifiedPaymentParametersSchema } from "../../routes/operator-intents-schemas-payment.js";
import { resolvePaymentReceiptTier } from "../../payments/resolve-payment-tier.js";
import type { OutboxWriter, RunInTransaction } from "./revenue.js";

export const RECORD_VERIFIED_PAYMENT_INTENT = "payment.record_verified";

/** Writes a Receipt row through the tx client (concrete impl wired at bootstrap
 *  via 1A-3's PrismaReceiptStore). Indirection mirrors OutboxWriter so the
 *  handler stays db-free + unit-testable.
 *  Note: uses MintReceiptInput (the actual 1A-3 contract in core) rather than the
 *  plan's CreateReceiptInput — the branch landed the store as ReceiptStore.mint(). */
export interface ReceiptWriter {
  write(input: MintReceiptInput, tx?: StoreTransactionContext): Promise<void>;
}

export function buildRecordVerifiedPaymentHandler(
  receiptWriter: ReceiptWriter,
  revenueStore: RevenueStore,
  outboxWriter: OutboxWriter,
  runInTransaction: RunInTransaction,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordVerifiedPaymentParametersSchema.parse(workUnit.parameters);
      const orgId = workUnit.organizationId;
      const verdict = resolvePaymentReceiptTier(params.provider);
      const chargedAt = new Date().toISOString();

      const event = await runInTransaction(async (tx) => {
        // 1. Payment receipt — tier/verified honestly derived from the provider.
        await receiptWriter.write(
          {
            organizationId: orgId,
            kind: "payment",
            tier: verdict.tier,
            status: "paid",
            bookingId: params.bookingId,
            opportunityId: params.opportunityId,
            externalRef: params.externalReference,
            amount: params.amountCents,
            currency: params.currency,
            provider: params.provider,
            connectionId: params.connectionId ?? null,
            evidence: {
              kind: "payment",
              basis: verdict.verified
                ? ("payment_verified" as const)
                : ("payment_degraded" as const),
              chargeId: params.externalReference,
              amountFetched: params.amountCents,
            },
            capturedBy: "payment.record_verified",
            verifiedAt: verdict.verified ? new Date() : null,
          },
          tx,
        );

        // 2. Verified revenue event welded to the booking. record() short-circuits
        //    on a duplicate externalReference, so a replay returns the existing row.
        const created = await revenueStore.record(
          {
            organizationId: orgId,
            contactId: params.contactId,
            opportunityId: params.opportunityId,
            amount: params.amountCents,
            currency: params.currency,
            type: "deposit",
            status: "confirmed",
            recordedBy: "stripe",
            verified: verdict.verified,
            bookingId: params.bookingId,
            externalReference: params.externalReference,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
          },
          tx,
        );

        // 3. `purchased` outbox event keyed off the revenue row id (replay-stable).
        await outboxWriter.write(
          `evt_pay_${created.id}`,
          "purchased",
          {
            type: "purchased",
            contactId: params.contactId,
            organizationId: orgId,
            value: params.amountCents,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
            occurredAt: chargedAt,
            source: "payment-verified",
            metadata: {
              bookingId: params.bookingId,
              opportunityId: params.opportunityId,
              externalReference: params.externalReference,
              currency: params.currency,
              provider: params.provider,
              verified: verdict.verified,
            },
          },
          tx,
        );
        return created;
      });

      return {
        outcome: "completed" as const,
        summary: `Recorded verified deposit of ${params.amountCents} cents ${params.currency} for booking ${params.bookingId}`,
        outputs: { event },
      };
    },
  };
}
