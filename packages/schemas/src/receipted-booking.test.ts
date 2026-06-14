import { describe, it, expect } from "vitest";
import {
  AttributionConfidenceSchema,
  ExceptionCodeSchema,
  ReceiptedBookingSchema,
} from "./receipted-booking.js";

const base = {
  id: "rb-1",
  organizationId: "org-1",
  bookingId: "bk-1",
  issuedAt: new Date("2026-06-14T00:00:00Z"),
  attributionConfidence: "high" as const,
  attributionUpdatedAt: new Date("2026-06-14T00:00:00Z"),
  exceptions: [],
  lastEvaluatedAt: new Date("2026-06-14T00:00:00Z"),
  createdAt: new Date("2026-06-14T00:00:00Z"),
};

describe("ReceiptedBookingSchema", () => {
  it("accepts a minimal valid row (optional snapshot/override fields omitted)", () => {
    expect(ReceiptedBookingSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an exceptions entry and a cents snapshot", () => {
    const r = ReceiptedBookingSchema.safeParse({
      ...base,
      attributionConfidence: "unattributed",
      expectedValueAtIssue: 45000,
      currency: "SGD",
      exceptions: [{ code: "missing_source", raisedAt: new Date(), resolvedAt: null }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown attribution-confidence value", () => {
    expect(AttributionConfidenceSchema.safeParse("guessed").success).toBe(false);
  });

  it("rejects an unknown exception code", () => {
    expect(ExceptionCodeSchema.safeParse("random").success).toBe(false);
  });

  it("rejects a non-integer / negative cents snapshot", () => {
    expect(ReceiptedBookingSchema.safeParse({ ...base, expectedValueAtIssue: 12.5 }).success).toBe(
      false,
    );
    expect(ReceiptedBookingSchema.safeParse({ ...base, expectedValueAtIssue: -1 }).success).toBe(
      false,
    );
  });
});
