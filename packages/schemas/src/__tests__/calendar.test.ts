import { describe, it, expect } from "vitest";
import {
  BookingStatusSchema,
  BookingSlotConflictError,
  isBookingSlotConflictError,
  BusinessHoursConfigSchema,
  DEFAULT_BUSINESS_HOURS,
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

describe("DEFAULT_BUSINESS_HOURS", () => {
  it("satisfies BusinessHoursConfigSchema (producer/consumer seam pin)", () => {
    // The calendar provider factory casts the stored businessHours to BusinessHoursConfig
    // WITHOUT validating it, so the seeded default must satisfy the contract the slot
    // generator and LocalCalendarProvider consume. Drive this from the REAL constant.
    expect(BusinessHoursConfigSchema.safeParse(DEFAULT_BUSINESS_HOURS).success).toBe(true);
  });

  it("uses the Asia/Singapore weekday default the pilot wedge expects", () => {
    expect(DEFAULT_BUSINESS_HOURS.timezone).toBe("Asia/Singapore");
    expect(DEFAULT_BUSINESS_HOURS.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });
});
