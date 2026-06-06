import { describe, it, expect } from "vitest";
import { resolvePaymentReceiptTier } from "./resolve-payment-tier.js";

describe("resolvePaymentReceiptTier", () => {
  it("a noop payment is T3_ADMIN_AUDIT, not verified, degraded (R1)", () => {
    const r = resolvePaymentReceiptTier("noop");
    expect(r.tier).toBe("T3_ADMIN_AUDIT");
    expect(r.verified).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it("a real PSP fetch-back (stripe) is T1_FETCH_BACK, verified, not degraded", () => {
    const r = resolvePaymentReceiptTier("stripe");
    expect(r.tier).toBe("T1_FETCH_BACK");
    expect(r.verified).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it("never resolves a noop provider to T1 (anti-fake invariant)", () => {
    expect(resolvePaymentReceiptTier("noop").tier).not.toBe("T1_FETCH_BACK");
  });
});
