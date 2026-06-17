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
const STARTS = new Date("2026-06-16T02:00:00Z");

/** Minimal valid ReceiptedBookingView. attributionConfidence + exceptions drive the aggregate;
 *  service + startsAt drive the worklist row (handles + ordering tiebreaks). */
function mkView(
  attributionConfidence: AttributionConfidence,
  exceptions: ExceptionEntry[] = [],
  bookingId = "bk",
  opts: { startsAt?: Date; service?: string } = {},
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
    service: opts.service ?? `svc-${bookingId}`,
    startsAt: opts.startsAt ?? STARTS,
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

    expect(result.cohortSize).toBe(5);
    expect(result.confidence).toEqual({
      deterministic: 2,
      high: 1,
      medium: 1,
      low: 0,
      unattributed: 1,
    });
    expect(result.exceptions).toEqual({
      missing_source: 1,
      missing_consent: 2,
      manual_override: 0,
      duplicate_contact_risk: 1,
    });
    // b3, b4, b5 each carry an open exception; b1, b2 are clean.
    expect(result.bookingsNeedingAttention).toBe(3);
    // Worst-first: b4 (2 codes) > b5 (unattributed, 1 code) > b3 (high, 1 code).
    expect(result.worklist.map((w) => w.bookingId)).toEqual(["b4", "b5", "b3"]);
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
    expect(result.worklist).toEqual([]);
    expect(result.confidence.low).toBe(1);
    expect(result.cohortSize).toBe(1);
  });

  it("excludes a manual_override-only row from the attention count but keeps it on the worklist and per-code breakdown", async () => {
    // The owner has already asserted attribution (override), so the booking is NOT an open action
    // item: it must not inflate bookingsNeedingAttention. It STILL appears on the worklist (so the
    // owner can see/undo the assertion) and STILL counts under exceptions.manual_override.
    const views: ReceiptedBookingView[] = [
      mkView("high", [{ code: "manual_override", raisedAt: RAISED }], "b-ov-only"),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    // Off the headline attention count.
    expect(result.bookingsNeedingAttention).toBe(0);
    // Still in the per-code breakdown.
    expect(result.exceptions.manual_override).toBe(1);
    // Still on the worklist, carrying the manual_override code.
    expect(result.worklist).toHaveLength(1);
    expect(result.worklist[0]?.bookingId).toBe("b-ov-only");
    expect(result.worklist[0]?.openExceptionCodes).toEqual(["manual_override"]);
  });

  it("counts a booking once for attention when it carries manual_override alongside a real open code", async () => {
    // manual_override does not drive attention, but the co-occurring missing_source does; the
    // booking is counted once and the breakdown records BOTH codes.
    const views: ReceiptedBookingView[] = [
      mkView(
        "unattributed",
        [
          { code: "manual_override", raisedAt: RAISED },
          { code: "missing_source", raisedAt: RAISED },
        ],
        "b-mixed",
      ),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result.bookingsNeedingAttention).toBe(1);
    expect(result.exceptions.manual_override).toBe(1);
    expect(result.exceptions.missing_source).toBe(1);
    expect(result.worklist[0]?.openExceptionCodes).toEqual(["missing_source", "manual_override"]);
  });

  it("returns an all-zero breakdown with an empty worklist for an empty cohort", async () => {
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
      worklist: [],
    });
  });

  it("counts each open exception code once per booking, even with duplicate entries", async () => {
    const views: ReceiptedBookingView[] = [
      mkView(
        "medium",
        [
          { code: "missing_consent", raisedAt: RAISED },
          { code: "missing_consent", raisedAt: RAISED },
        ],
        "b1",
      ),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result.exceptions.missing_consent).toBe(1);
    expect(result.bookingsNeedingAttention).toBe(1);
    expect(result.worklist).toHaveLength(1);
    expect(result.worklist[0]?.openExceptionCodes).toEqual(["missing_consent"]);
  });

  it("builds each worklist row with the handle, confidence, and deduped codes in canonical order", async () => {
    const views: ReceiptedBookingView[] = [
      mkView(
        "medium",
        // Entries supplied out of canonical order + a duplicate; row must be deduped + canonical.
        [
          { code: "duplicate_contact_risk", raisedAt: RAISED },
          { code: "missing_consent", raisedAt: RAISED },
          { code: "missing_consent", raisedAt: RAISED },
        ],
        "b1",
        { service: "Botox consult", startsAt: new Date("2026-06-16T02:00:00Z") },
      ),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result.worklist[0]).toEqual({
      bookingId: "b1",
      service: "Botox consult",
      startsAt: "2026-06-16T02:00:00.000Z",
      attributionConfidence: "medium",
      // Canonical taxonomy order: missing_consent before duplicate_contact_risk.
      openExceptionCodes: ["missing_consent", "duplicate_contact_risk"],
      issuedAt: null,
      overridden: false,
    });
  });

  it("caps the worklist and keeps bookingsNeedingAttention as the true total", async () => {
    const views: ReceiptedBookingView[] = Array.from({ length: 30 }, (_, i) =>
      mkView("unattributed", [{ code: "missing_source", raisedAt: RAISED }], `b${i}`),
    );
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result.bookingsNeedingAttention).toBe(30);
    expect(result.worklist).toHaveLength(25);
  });

  it("breaks ties by oldest appointment first, then bookingId", async () => {
    const views: ReceiptedBookingView[] = [
      // Same code-count + confidence; differ only on startsAt. Older 'bz' must precede newer 'ba'.
      mkView("low", [{ code: "missing_source", raisedAt: RAISED }], "ba", {
        startsAt: new Date("2026-06-18T00:00:00Z"),
      }),
      mkView("low", [{ code: "missing_source", raisedAt: RAISED }], "bz", {
        startsAt: new Date("2026-06-16T00:00:00Z"),
      }),
      // Same startsAt as 'bz'; bookingId 'bk' breaks the final tie (bk < bz).
      mkView("low", [{ code: "missing_source", raisedAt: RAISED }], "bk", {
        startsAt: new Date("2026-06-16T00:00:00Z"),
      }),
    ];
    const receiptedBookings = { listForCohort: vi.fn(async () => views) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    expect(result.worklist.map((w) => w.bookingId)).toEqual(["bk", "bz", "ba"]);
  });

  it("populates issuedAt (ISO string) and overridden on each worklist row from the view", async () => {
    const ISSUED = new Date("2026-06-01T09:00:00.000Z");
    // View with a persisted row: issuedAt present + overriddenBy set.
    const overriddenView: ReceiptedBookingView = {
      ...mkView("high", [{ code: "manual_override", raisedAt: RAISED }], "b-ov"),
      issuedAt: ISSUED,
      overriddenBy: "user-123",
    };
    // View without a persisted row: issuedAt/overriddenBy absent (pre-hook booking).
    const unhookedView: ReceiptedBookingView = mkView(
      "unattributed",
      [{ code: "missing_source", raisedAt: RAISED }],
      "b-un",
    );
    const receiptedBookings = { listForCohort: vi.fn(async () => [overriddenView, unhookedView]) };

    const result = await computeReceiptedBookingQuality(ctx, receiptedBookings as never);

    const ovRow = result.worklist.find((w) => w.bookingId === "b-ov");
    const unRow = result.worklist.find((w) => w.bookingId === "b-un");
    expect(ovRow?.issuedAt).toBe(ISSUED.toISOString());
    expect(ovRow?.overridden).toBe(true);
    expect(unRow?.issuedAt).toBe(null);
    expect(unRow?.overridden).toBe(false);
  });
});
