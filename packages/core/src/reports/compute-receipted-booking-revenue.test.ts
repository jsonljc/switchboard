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
    service: "svc",
    startsAt: new Date("2026-06-16T02:00:00Z"),
    paymentEventIds: [],
    expectedValue: null,
    paid: false,
    paidValueCents: null,
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
    expect(r).toEqual({
      revenueCents: 0,
      currency: null,
      bookingsWithValue: 0,
      cohortSize: 0,
      paidRevenueCents: 0,
      paidBookings: 0,
    });
  });

  it("sums proven-paid value and counts paid bookings, independent of the expected dimension", async () => {
    const r = await computeReceiptedBookingRevenue(
      ctx,
      stores([
        // issued + attended + paid: contributes to BOTH expected (snapshot) and paid
        view({
          issuedAt: new Date("2026-06-09"),
          expectedValueAtIssue: 45000,
          paid: true,
          paidValueCents: 30000,
        }),
        // booked, not yet paid: contributes to expected only
        view({ issuedAt: null, expectedValue: 30000, paid: false, paidValueCents: null }),
        // historical + paid
        view({ issuedAt: null, expectedValue: 20000, paid: true, paidValueCents: 20000 }),
      ]),
    );
    expect(r.paidRevenueCents).toBe(50000); // 30000 + 20000
    expect(r.paidBookings).toBe(2);
    // the expected dimension is unchanged by the paid additions
    expect(r.revenueCents).toBe(95000); // 45000 + 30000 + 20000
    expect(r.bookingsWithValue).toBe(3);
    expect(r.cohortSize).toBe(3);
  });

  it("is NaN-safe on the paid dimension: a paid booking with null/NaN paidValueCents counts but adds 0", async () => {
    const r = await computeReceiptedBookingRevenue(
      ctx,
      stores([
        view({ issuedAt: null, expectedValue: 0, paid: true, paidValueCents: null }),
        view({
          issuedAt: null,
          expectedValue: 0,
          paid: true,
          paidValueCents: NaN as unknown as number,
        }),
        view({ issuedAt: null, expectedValue: 0, paid: true, paidValueCents: 1500 }),
      ]),
    );
    expect(Number.isFinite(r.paidRevenueCents)).toBe(true);
    expect(r.paidRevenueCents).toBe(1500);
    expect(r.paidBookings).toBe(3);
  });
});
