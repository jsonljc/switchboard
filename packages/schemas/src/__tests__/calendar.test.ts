import { describe, it, expect } from "vitest";
import {
  BookingStatusSchema,
  BookingSlotConflictError,
  isBookingSlotConflictError,
} from "../calendar.js";

describe("BookingStatusSchema", () => {
  it("accepts 'failed' as a valid booking status", () => {
    expect(BookingStatusSchema.parse("failed")).toBe("failed");
  });

  it("rejects invalid statuses", () => {
    expect(() => BookingStatusSchema.parse("bogus")).toThrow();
  });
});

describe("BookingSlotConflictError", () => {
  it("carries the SLOT_CONFLICT code and the conflicting booking id", () => {
    const err = new BookingSlotConflictError("bk-1");
    expect(err.code).toBe("SLOT_CONFLICT");
    expect(err.conflictingBookingId).toBe("bk-1");
    expect(err).toBeInstanceOf(Error);
  });
  it("is detected structurally (cross-package safe)", () => {
    expect(isBookingSlotConflictError(new BookingSlotConflictError("x"))).toBe(true);
    expect(isBookingSlotConflictError({ code: "SLOT_CONFLICT" })).toBe(true);
    expect(isBookingSlotConflictError(new Error("nope"))).toBe(false);
    expect(isBookingSlotConflictError(null)).toBe(false);
  });
});
