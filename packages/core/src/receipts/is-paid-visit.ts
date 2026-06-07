import type { Receipt, PaidVisitVerdict } from "@switchboard/schemas";

/**
 * Structured verdict — never a bare boolean (spec §11). R1/R2:
 * - calendar booked -> attended, not paid, not held
 * - calendar held -> held, payment unverified
 * - verified payment (real provider, T1) -> paid
 * - noop/degraded payment -> degraded, NOT production-countable
 * - void -> neither
 */
export function isPaidVisit(receipt: Receipt): PaidVisitVerdict {
  const { kind, status, provider, tier } = receipt;

  if (status === "void") {
    return { paid: false, held: false, tier, basis: "void", degraded: false };
  }

  if (kind === "calendar") {
    return {
      paid: false,
      held: status === "held",
      tier,
      basis: "calendar_confirmed",
      degraded: false,
    };
  }

  // kind === "payment"
  const isNoop = provider === "noop";
  if (isNoop) {
    return { paid: false, held: false, tier, basis: "payment_degraded", degraded: true };
  }
  const paid = status === "paid" && tier === "T1_FETCH_BACK";
  return { paid, held: false, tier, basis: "payment_verified", degraded: false };
}

/** R1: in production, a degraded (e.g. noop) verdict never counts as a real paid visit. */
export function isProductionCountable(verdict: PaidVisitVerdict, env: string): boolean {
  if (env === "production" && verdict.degraded) return false;
  return verdict.paid;
}
