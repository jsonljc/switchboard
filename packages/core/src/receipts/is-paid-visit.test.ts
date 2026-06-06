import { describe, it, expect } from "vitest";
import type { Receipt } from "@switchboard/schemas";
import { isPaidVisit, isProductionCountable } from "./is-paid-visit.js";

function receipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: "r",
    organizationId: "org-1",
    kind: "calendar",
    tier: "T1_FETCH_BACK",
    status: "booked",
    capturedBy: "calendar-book",
    evidence: { kind: "calendar", basis: "calendar_confirmed", calendarEventId: "gcal_1" },
    createdAt: new Date(),
    ...overrides,
  } as Receipt;
}

describe("isPaidVisit", () => {
  it("calendar booked -> not paid, not held, basis calendar_confirmed", () => {
    const v = isPaidVisit(receipt({ kind: "calendar", status: "booked" }));
    expect(v.paid).toBe(false);
    expect(v.held).toBe(false);
    expect(v.basis).toBe("calendar_confirmed");
    expect(v.degraded).toBe(false);
  });

  it("calendar held -> held, not paid", () => {
    const v = isPaidVisit(receipt({ kind: "calendar", status: "held" }));
    expect(v.held).toBe(true);
    expect(v.paid).toBe(false);
  });

  it("verified payment (T1, real provider) -> paid", () => {
    const v = isPaidVisit(
      receipt({
        kind: "payment",
        status: "paid",
        provider: "stripe",
        tier: "T1_FETCH_BACK",
        evidence: {
          kind: "payment",
          basis: "payment_verified",
          chargeId: "ch_1",
          amountFetched: 5000,
        },
      }),
    );
    expect(v.paid).toBe(true);
    expect(v.degraded).toBe(false);
  });

  it("noop payment -> degraded and NOT production-countable", () => {
    const v = isPaidVisit(
      receipt({
        kind: "payment",
        status: "paid",
        provider: "noop",
        tier: "T3_ADMIN_AUDIT",
        evidence: {
          kind: "payment",
          basis: "payment_degraded",
          chargeId: "noop_1",
          amountFetched: 5000,
        },
      }),
    );
    expect(v.degraded).toBe(true);
    expect(v.paid).toBe(false);
    expect(isProductionCountable(v, "production")).toBe(false);
  });

  it("void -> neither paid nor held", () => {
    const v = isPaidVisit(receipt({ kind: "payment", status: "void", provider: "stripe" }));
    expect(v.paid).toBe(false);
    expect(v.held).toBe(false);
  });

  it("returns a structured object, never a bare boolean", () => {
    const v = isPaidVisit(receipt({}));
    expect(typeof v).toBe("object");
    expect(v).toHaveProperty("tier");
  });
});
