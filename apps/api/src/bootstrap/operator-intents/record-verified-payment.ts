// apps/api/src/bootstrap/operator-intents/record-verified-payment.ts
// ---------------------------------------------------------------------------
// payment.record_verified handler factory (spec 1A-4b, architecture A).
//
// F3 hardening (docs/audits/2026-06-10-security-audit/11-tickets.md):
//   (1) AUTHORITY: `verified`/tier/amount are derived from a SERVER-SIDE PSP
//       fetch-back (`PaymentVerifier`), never from the caller-supplied
//       `provider`/`amountCents`. A forged / unknown externalReference returns a
//       null charge and a not-yet-settled charge is not `paid` -> in both cases
//       NOTHING is written (no verified revenue row, no `purchased` conversion).
//   (2) SERVICE-ONLY: the intent rejects any actor that is not service/system.
//       The genuine caller is the in-process HMAC-verified payments webhook,
//       which submits as a `service` actor with the re-fetched amount.
//
// In ONE runInTransaction (only on a confirmed paid charge) it writes:
//   1. a payment Receipt (kind=payment, status=paid) whose tier/verified are the
//      fetch-back verdict (R1 honest degradation: noop -> T3, real+paid -> T1);
//   2. a LifecycleRevenueEvent(type=deposit, bookingId, verified) welded to the
//      booking — record() short-circuits a duplicate externalReference;
//   3. a `purchased` OutboxEvent keyed off the revenue row id (replay-stable).
// R2: this is a PAYMENT receipt (status=paid) — the paid signal is the verified
// payment, never a calendar-only receipt.
// ---------------------------------------------------------------------------
import type { RevenueStore, StoreTransactionContext, MintReceiptInput } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import type { VerifiedPayment } from "@switchboard/schemas";
import type { ReceiptExceptionReason } from "@switchboard/schemas";
import { RecordVerifiedPaymentParametersSchema } from "../../routes/operator-intents-schemas-payment.js";
import { resolvePaymentReceiptTier } from "../../payments/resolve-payment-tier.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";
import type { OutboxWriter, RunInTransaction } from "./revenue.js";

export const RECORD_VERIFIED_PAYMENT_INTENT = "payment.record_verified";

/** Server-side PSP fetch-back: resolves the authoritative charge for an org's
 *  externalReference, or null if the charge does not exist on the org's
 *  connected account. Wired from `app.paymentPortFactory` at bootstrap; injected
 *  so the handler stays db/PSP-free and unit-testable with a fake. */
export type PaymentVerifier = (
  organizationId: string,
  externalReference: string,
) => Promise<VerifiedPayment | null>;

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
  verifyPayment: PaymentVerifier,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      // (2) SERVICE-ONLY. A tenant/user (or agent) actor must never mint a
      // verified payment. The only legitimate caller is the in-process payments
      // webhook (a `service` actor); the public /ingress/submit edge also refuses
      // this intent. Fail closed before any read/write.
      const actorType = workUnit.actor?.type;
      if (actorType !== "service" && actorType !== "system") {
        return {
          outcome: "failed" as const,
          summary: "payment.record_verified requires a service/system actor",
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.PAYMENT_FORBIDDEN_ACTOR,
            message: "payment.record_verified requires a service/system actor",
          },
        };
      }

      const params = RecordVerifiedPaymentParametersSchema.parse(workUnit.parameters);
      const orgId = workUnit.organizationId;

      // (1) AUTHORITY. Re-verify against the PSP. Only a charge the processor
      // confirms is settled (`paid`) on the org's connected account may become a
      // verified payment; a null charge (forged/unknown ref) or a not-yet-settled
      // charge writes nothing — and therefore emits no `purchased` conversion.
      const charge = await verifyPayment(orgId, params.externalReference);
      if (!charge || charge.status !== "paid") {
        return {
          outcome: "failed" as const,
          summary: "No PSP-confirmed paid charge for externalReference",
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.PAYMENT_NOT_VERIFIED,
            message: "No PSP-confirmed paid charge for externalReference",
          },
        };
      }

      const verdict = resolvePaymentReceiptTier(charge);
      // Money-authority: amount/currency/provider come from the PSP charge, never
      // from the request body (spec §9.4).
      const amountCents = charge.amountCents;
      const currency = charge.currency;
      const provider = charge.provider;
      const chargedAt = new Date().toISOString();

      const event = await runInTransaction(async (tx) => {
        // Slice 5: an unverified (noop) payment receipt has no verifiable external source-of-truth
        // (no real PSP fetch-back), so stamp the durable provenance exception. Same condition that
        // sets evidence.basis = payment_degraded and degrades the PaidVisitVerdict.
        const exceptions: ReceiptExceptionReason[] = verdict.verified ? [] : ["missing_source"];

        // 1. Payment receipt — tier/verified are the fetch-back verdict.
        await receiptWriter.write(
          {
            organizationId: orgId,
            kind: "payment",
            tier: verdict.tier,
            status: "paid",
            bookingId: params.bookingId,
            opportunityId: params.opportunityId,
            externalRef: params.externalReference,
            amount: amountCents,
            currency,
            provider,
            connectionId: params.connectionId ?? null,
            evidence: {
              kind: "payment",
              basis: verdict.verified
                ? ("payment_verified" as const)
                : ("payment_degraded" as const),
              chargeId: params.externalReference,
              amountFetched: amountCents,
            },
            capturedBy: "payment.record_verified",
            verifiedAt: verdict.verified ? new Date() : null,
            exceptions,
          },
          tx,
        );

        // 2. Revenue event welded to the booking. record() short-circuits on a
        //    duplicate externalReference, so a replay returns the existing row.
        const created = await revenueStore.record(
          {
            organizationId: orgId,
            contactId: params.contactId,
            opportunityId: params.opportunityId,
            amount: amountCents,
            currency,
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
            value: amountCents,
            sourceCampaignId: params.sourceCampaignId ?? null,
            sourceAdId: params.sourceAdId ?? null,
            occurredAt: chargedAt,
            source: "payment-verified",
            metadata: {
              bookingId: params.bookingId,
              opportunityId: params.opportunityId,
              externalReference: params.externalReference,
              currency,
              provider,
              verified: verdict.verified,
            },
          },
          tx,
        );
        return created;
      });

      return {
        outcome: "completed" as const,
        summary: `Recorded verified deposit of ${amountCents} cents ${currency} for booking ${params.bookingId}`,
        outputs: { event },
      };
    },
  };
}
