import { describe, it, expect } from "vitest";
import { NoopCalendarProvider, isNoopCalendarProvider } from "../noop-calendar-provider.js";

describe("isNoopCalendarProvider", () => {
  it("returns true for a NoopCalendarProvider instance", () => {
    expect(isNoopCalendarProvider(new NoopCalendarProvider())).toBe(true);
  });

  it("returns false for a non-Noop provider", () => {
    const fake = {
      listAvailableSlots: async () => [],
      createBooking: async () => ({}) as never,
      cancelBooking: async () => undefined,
      rescheduleBooking: async () => ({}) as never,
      getBooking: async () => null,
      healthCheck: async () => ({ status: "connected", latencyMs: 5 }) as never,
    };
    expect(isNoopCalendarProvider(fake as never)).toBe(false);
  });
});
