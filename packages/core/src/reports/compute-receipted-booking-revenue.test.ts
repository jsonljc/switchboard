import { describe, it, expect, vi } from "vitest";
import { computeReceiptedBookingRevenue } from "./compute-receipted-booking-revenue.js";
import type { ReceiptedBookingView } from "@switchboard/schemas";

const ctx = {
  orgId: "org-1",
  current: { window: "weekly", start: new Date("2026-06-08"), end: new Date("2026-06-15") },
  prior: { window: "weekly", start: new Date("2026-06-01"), end: new Date("2026-06-08") },
  computedAt: new Date("2026-06-15"),
} as never;

function view(p: Partial<ReceiptedBookingView>): ReceiptedBookingView {
  return {
    bookingId: "b",
    organizationId: "org-1",
    attributionConfidence: "low",
    exceptions: [],
    receipts: [],
    contactKey: null,
    consentGrantedAt: null,
    consentRevokedAt: null,
    sourceEvidence: {},
    traceId: null,
    matchedPolicies: null,
    humanApprovalId: null,
    attendanceState: null,
    paymentEventIds: [],
    expectedValue: null,
    ...p,
  };
}

const stores = (views: ReceiptedBookingView[]) =>
  ({ listForCohort: vi.fn().mockResolvedValue(views) }) as never;

describe("computeReceiptedBookingRevenue", () => {
  it("uses the persisted snapshot for issued rows and the live value for historical rows", async () => {
    const r = await computeReceiptedBookingRevenue(
      ctx,
      stores([
        view({
          issuedAt: new Date("2026-06-09"),
          expectedValueAtIssue: 45000,
          currency: "SGD",
          expectedValue: 99999, // live drift is ignored once a snapshot exists
        }),
        view({ issuedAt: null, expectedValue: 30000 }), // historical -> live fallback
      ]),
    );
    expect(r.revenueCents).toBe(75000); // 45000 (snapshot) + 30000 (live)
    expect(r.currency).toBe("SGD");
    expect(r.bookingsWithValue).toBe(2);
    expect(r.cohortSize).toBe(2);
  });

  it("a persisted null snapshot contributes 0 and never falls back to live", async () => {
    const r = await computeReceiptedBookingRevenue(
      ctx,
      stores([
        view({
          issuedAt: new Date("2026-06-09"),
          expectedValueAtIssue: null,
          expectedValue: 50000,
        }),
      ]),
    );
    expect(r.revenueCents).toBe(0);
    expect(r.bookingsWithValue).toBe(0);
    expect(r.cohortSize).toBe(1);
  });

  it("is NaN-safe: non-finite/negative values are skipped, the sum stays finite", async () => {
    const r = await computeReceiptedBookingRevenue(
      ctx,
      stores([
        view({ issuedAt: null, expectedValue: NaN }),
        view({ issuedAt: null, expectedValue: -5 }),
        view({ issuedAt: null, expectedValue: 1000 }),
      ]),
    );
    expect(Number.isFinite(r.revenueCents)).toBe(true);
    expect(r.revenueCents).toBe(1000);
    expect(r.bookingsWithValue).toBe(1);
  });

  it("empty cohort -> zero revenue, null currency", async () => {
    const r = await computeReceiptedBookingRevenue(ctx, stores([]));
    expect(r).toEqual({ revenueCents: 0, currency: null, bookingsWithValue: 0, cohortSize: 0 });
  });
});
