import { describe, it, expect } from "vitest";
import { BookingStatusSchema } from "../calendar.js";

describe("BookingStatusSchema", () => {
  it("accepts 'failed' as a valid booking status", () => {
    expect(BookingStatusSchema.parse("failed")).toBe("failed");
  });

  it("rejects invalid statuses", () => {
    expect(() => BookingStatusSchema.parse("bogus")).toThrow();
  });
});
