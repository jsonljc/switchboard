// apps/api/src/payments/resolve-payment-tier.ts
// ---------------------------------------------------------------------------
// R1 honest-degradation gate for payment receipts, anchored to a SERVER-SIDE
// PSP fetch-back (`PaymentPort.retrievePayment`) — never to a caller-supplied
// provider string (F3 fix: docs/audits/2026-06-10-security-audit/11-tickets.md).
// A production-countable (T1, verified=true) paid visit requires a real external
// charge the PSP confirms is settled (status "paid") on a real provider. A null
// charge (a forged / not-found externalReference), a not-yet-settled charge, or
// the degraded Noop adapter is never `verified` and caps at T3_ADMIN_AUDIT.
// ---------------------------------------------------------------------------
import type { ReceiptTier, VerifiedPayment } from "@switchboard/schemas";

export interface PaymentTierVerdict {
  tier: ReceiptTier;
  /** True only for a real external PSP charge confirmed `paid`. Never true for a
   *  noop provider, a non-paid charge, or a missing (null) charge. */
  verified: boolean;
  /** Honest downgrade flag — a noop/local/unconfirmed payment is degraded evidence. */
  degraded: boolean;
}

export function resolvePaymentReceiptTier(charge: VerifiedPayment | null): PaymentTierVerdict {
  if (charge && charge.provider !== "noop" && charge.status === "paid") {
    return { tier: "T1_FETCH_BACK", verified: true, degraded: false };
  }
  return { tier: "T3_ADMIN_AUDIT", verified: false, degraded: true };
}
