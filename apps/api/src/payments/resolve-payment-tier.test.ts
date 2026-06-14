import { describe, it, expect } from "vitest";
import type { VerifiedPayment } from "@switchboard/schemas";
import { resolvePaymentReceiptTier } from "./resolve-payment-tier.js";

function charge(over: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return {
    provider: "stripe",
    externalReference: "pi_1",
    amountCents: 5000,
    currency: "sgd",
    status: "paid",
    bookingId: "bk-1",
    ...over,
  };
}

describe("resolvePaymentReceiptTier", () => {
  it("a real PSP charge that is paid is T1_FETCH_BACK, verified, not degraded", () => {
    const r = resolvePaymentReceiptTier(charge());
    expect(r.tier).toBe("T1_FETCH_BACK");
    expect(r.verified).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it("a noop charge is T3_ADMIN_AUDIT, not verified, degraded (R1)", () => {
    const r = resolvePaymentReceiptTier(charge({ provider: "noop" }));
    expect(r.tier).toBe("T3_ADMIN_AUDIT");
    expect(r.verified).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it("a real charge that is NOT paid is never verified (anti-fake invariant)", () => {
    for (const status of ["pending", "failed", "refunded"] as const) {
      const r = resolvePaymentReceiptTier(charge({ status }));
      expect(r.verified).toBe(false);
      expect(r.tier).not.toBe("T1_FETCH_BACK");
    }
  });

  it("a null charge (forged / not-found reference) is never verified", () => {
    const r = resolvePaymentReceiptTier(null);
    expect(r.verified).toBe(false);
    expect(r.tier).toBe("T3_ADMIN_AUDIT");
  });
});
