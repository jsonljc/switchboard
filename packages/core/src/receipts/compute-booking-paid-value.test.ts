import { describe, it, expect } from "vitest";
import type { Receipt } from "@switchboard/schemas";
import { computeBookingPaidValue } from "./compute-booking-paid-value.js";

/** Minimal payment-receipt projection (the exact Pick the helper consumes). */
function paymentReceipt(
  overrides: Partial<Pick<Receipt, "kind" | "status" | "provider" | "tier" | "amount">> = {},
): Pick<Receipt, "kind" | "status" | "provider" | "tier" | "amount"> {
  return {
    kind: "payment",
    status: "paid",
    provider: "stripe",
    tier: "T1_FETCH_BACK",
    amount: 5000,
    ...overrides,
  };
}

describe("computeBookingPaidValue", () => {
  it("a verified T1 stripe paid receipt is paid and contributes its amount", () => {
    const result = computeBookingPaidValue([paymentReceipt({ amount: 5000 })]);
    expect(result.paid).toBe(true);
    expect(result.paidValueCents).toBe(5000);
  });

  it("an empty receipt list is not paid and contributes null", () => {
    const result = computeBookingPaidValue([]);
    expect(result.paid).toBe(false);
    expect(result.paidValueCents).toBeNull();
  });

  it("a noop/degraded (T3) payment receipt is NOT paid and is excluded from the sum", () => {
    const result = computeBookingPaidValue([
      paymentReceipt({ provider: "noop", tier: "T3_ADMIN_AUDIT", amount: 9999 }),
    ]);
    expect(result.paid).toBe(false);
    expect(result.paidValueCents).toBeNull();
  });

  it("a calendar receipt never counts as paid", () => {
    const result = computeBookingPaidValue([
      { kind: "calendar", status: "booked", provider: null, tier: "T1_FETCH_BACK", amount: null },
    ]);
    expect(result.paid).toBe(false);
    expect(result.paidValueCents).toBeNull();
  });

  it("a voided payment receipt is not paid", () => {
    const result = computeBookingPaidValue([paymentReceipt({ status: "void", amount: 5000 })]);
    expect(result.paid).toBe(false);
    expect(result.paidValueCents).toBeNull();
  });

  it("sums multiple distinct verified payments on one booking (deposit + final)", () => {
    const result = computeBookingPaidValue([
      paymentReceipt({ amount: 3000 }),
      paymentReceipt({ amount: 7000 }),
    ]);
    expect(result.paid).toBe(true);
    expect(result.paidValueCents).toBe(10000);
  });

  it("excludes a degraded payment from the sum while still counting a real one", () => {
    const result = computeBookingPaidValue([
      paymentReceipt({ amount: 5000 }),
      paymentReceipt({ provider: "noop", tier: "T3_ADMIN_AUDIT", amount: 9999 }),
    ]);
    expect(result.paid).toBe(true);
    expect(result.paidValueCents).toBe(5000);
  });

  it("a paid receipt with a null amount counts as paid but contributes zero (not null)", () => {
    const result = computeBookingPaidValue([paymentReceipt({ amount: null })]);
    expect(result.paid).toBe(true);
    expect(result.paidValueCents).toBe(0);
  });

  it("NaN-safe: a non-finite amount on a paid receipt contributes zero, never NaN", () => {
    const result = computeBookingPaidValue([paymentReceipt({ amount: Number.NaN })]);
    expect(result.paid).toBe(true);
    expect(result.paidValueCents).toBe(0);
    expect(Number.isNaN(result.paidValueCents)).toBe(false);
  });

  it("NaN-safe: a negative amount is treated as no contribution", () => {
    const result = computeBookingPaidValue([paymentReceipt({ amount: -100 })]);
    expect(result.paid).toBe(true);
    expect(result.paidValueCents).toBe(0);
  });
});
