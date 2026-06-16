import { describe, it, expectTypeOf } from "vitest";
import type { ReceiptedBookingWorklistItem } from "./v1.js";

describe("ReceiptedBookingWorklistItem", () => {
  it("carries issuedAt (ISO string or null) and overridden boolean", () => {
    // Compile-time shape check: all fields, including the new ones.
    const row: ReceiptedBookingWorklistItem = {
      bookingId: "bk_1",
      service: "Botox consult",
      startsAt: "2026-06-16T02:00:00.000Z",
      attributionConfidence: "high",
      openExceptionCodes: ["missing_source"],
      issuedAt: "2026-06-15T10:00:00.000Z",
      overridden: false,
    };
    expectTypeOf(row.issuedAt).toEqualTypeOf<string | null>();
    expectTypeOf(row.overridden).toEqualTypeOf<boolean>();
  });

  it("accepts issuedAt = null (no persisted row for pre-hook bookings)", () => {
    const row: ReceiptedBookingWorklistItem = {
      bookingId: "bk_2",
      service: "Lip filler",
      startsAt: "2026-06-10T04:00:00.000Z",
      attributionConfidence: "unattributed",
      openExceptionCodes: ["missing_source"],
      issuedAt: null,
      overridden: false,
    };
    expectTypeOf(row.issuedAt).toEqualTypeOf<string | null>();
  });
});
