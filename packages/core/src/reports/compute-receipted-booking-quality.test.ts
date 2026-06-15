import { describe, it, expect, vi } from "vitest";
import type {
  AttributionConfidence,
  ExceptionEntry,
  ReceiptedBookingView,
} from "@switchboard/schemas";
import { computeReceiptedBookingQuality } from "./compute-receipted-booking-quality.js";

const ctx = {
  orgId: "o1",
  current: { start: new Date("2026-06-08"), end: new Date("2026-06-15") },
  computedAt: new Date("2026-06-14"),
} as never;

const RAISED = new Date("2026-06-10");

/** Minimal valid ReceiptedBookingView — only attributionConfidence + exceptions drive the aggregate. */
function mkView(
  attributionConfidence: AttributionConfidence,
  exceptions: ExceptionEntry[] = [],
  bookingId = "bk",
): ReceiptedBookingView {
  return {
    bookingId,
    organizationId: "o1",
    attributionConfidence,
    exceptions,
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
  };
}

describe("computeReceiptedBookingQuality", () => {
  it("aggregates the confidence breakdown and the open-exception worklist over the cohort", async () => {
    const views: ReceiptedBookingView[] = [
      mkView("deterministic", [], "b1"),
      mkView("deterministic", [], "b2"),
      mkView("high", [{ code: "missing_consent", raisedAt: RAISED }], "b3"),
      mkView(
        "medium",
        [
          { code: "missing_consent", raisedAt: RAISED },
          { code: "duplicate_contact_risk", raisedAt: RAISED },
        ],
        "b4",
      ),
      mkView("unattributed", [{ code: "missing_source", raisedAt: RAISED }], "b5"),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result).toEqual({
      cohortSize: 5,
      confidence: { deterministic: 2, high: 1, medium: 1, low: 0, unattributed: 1 },
      exceptions: {
        missing_source: 1,
        missing_consent: 2,
        manual_override: 0,
        duplicate_contact_risk: 1,
      },
      // b3, b4, b5 each carry an open exception; b1, b2 are clean.
      bookingsNeedingAttention: 3,
    });
    expect(receiptedBookings.listForCohort).toHaveBeenCalledWith({
      orgId: "o1",
      from: new Date("2026-06-08"),
      to: new Date("2026-06-15"),
    });
  });

  it("excludes resolved exceptions from the worklist (only open entries count)", async () => {
    const views: ReceiptedBookingView[] = [
      mkView(
        "low",
        [{ code: "missing_consent", raisedAt: RAISED, resolvedAt: new Date("2026-06-12") }],
        "b1",
      ),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result.exceptions.missing_consent).toBe(0);
    expect(result.bookingsNeedingAttention).toBe(0);
    expect(result.confidence.low).toBe(1);
    expect(result.cohortSize).toBe(1);
  });

  it("returns an all-zero breakdown for an empty cohort", async () => {
    const receiptedBookings = { listForCohort: vi.fn(async () => []) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result).toEqual({
      cohortSize: 0,
      confidence: { deterministic: 0, high: 0, medium: 0, low: 0, unattributed: 0 },
      exceptions: {
        missing_source: 0,
        missing_consent: 0,
        manual_override: 0,
        duplicate_contact_risk: 0,
      },
      bookingsNeedingAttention: 0,
    });
  });
});
