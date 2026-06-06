// apps/api/src/payments/resolve-payment-tier.ts
// ---------------------------------------------------------------------------
// R1 honest-degradation gate for payment receipts. The Noop adapter exercises
// the write path but has NO external corroboration, so a noop payment is capped
// at T3_ADMIN_AUDIT and is never `verified` -> it can never become a
// production-countable (verified=true / T1) paid visit. Only a real external
// PSP fetch-back yields T1_FETCH_BACK + verified=true (spec sec.8/sec.9).
// ---------------------------------------------------------------------------
import type { ReceiptTier } from "@switchboard/schemas";

export interface PaymentTierVerdict {
  tier: ReceiptTier;
  /** True only for a real external PSP fetch-back; this is the
   *  production-countable signal. Never true for a noop provider. */
  verified: boolean;
  /** Honest downgrade flag — a noop/local payment is degraded evidence. */
  degraded: boolean;
}

export function resolvePaymentReceiptTier(provider: string): PaymentTierVerdict {
  if (provider === "noop") {
    return { tier: "T3_ADMIN_AUDIT", verified: false, degraded: true };
  }
  return { tier: "T1_FETCH_BACK", verified: true, degraded: false };
}
