import { describe, it, expect } from "vitest";
import { ReceiptSchema, ReceiptStatusSchema, clampTierForUntrustedProvider } from "./receipt.js";

describe("ReceiptSchema", () => {
  it("accepts a valid calendar receipt with status booked", () => {
    const parsed = ReceiptSchema.safeParse({
      id: "rcpt-1",
      organizationId: "org-1",
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: "booked",
      bookingId: "bk-1",
      capturedBy: "calendar-book",
      evidence: { kind: "calendar", basis: "calendar_confirmed", calendarEventId: "gcal_123" },
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid payment receipt with status paid", () => {
    const parsed = ReceiptSchema.safeParse({
      id: "rcpt-2",
      organizationId: "org-1",
      kind: "payment",
      tier: "T1_FETCH_BACK",
      status: "paid",
      provider: "stripe",
      externalRef: "pi_abc",
      amount: 5000,
      currency: "SGD",
      capturedBy: "payment.record_verified",
      evidence: {
        kind: "payment",
        basis: "payment_verified",
        chargeId: "ch_abc",
        amountFetched: 5000,
      },
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a calendar receipt carrying payment-shaped evidence", () => {
    const parsed = ReceiptSchema.safeParse({
      id: "rcpt-3",
      organizationId: "org-1",
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: "booked",
      capturedBy: "calendar-book",
      evidence: { kind: "payment", basis: "payment_verified", chargeId: "ch_x", amountFetched: 1 },
      createdAt: new Date(),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(ReceiptStatusSchema.safeParse("partial").success).toBe(false);
  });
});

describe("clampTierForUntrustedProvider", () => {
  it("clamps T1 and T2 down to T3 for untrusted providers", () => {
    expect(clampTierForUntrustedProvider("T1_FETCH_BACK")).toBe("T3_ADMIN_AUDIT");
    expect(clampTierForUntrustedProvider("T2_PROVIDER_SIGNATURE")).toBe("T3_ADMIN_AUDIT");
  });
  it("leaves T3 as T3", () => {
    expect(clampTierForUntrustedProvider("T3_ADMIN_AUDIT")).toBe("T3_ADMIN_AUDIT");
  });
});
