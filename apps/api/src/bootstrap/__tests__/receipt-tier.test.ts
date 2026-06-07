import { describe, it, expect } from "vitest";
import { LocalCalendarProvider } from "@switchboard/core/calendar";
import type { CalendarProvider } from "@switchboard/schemas";
import { NoopCalendarProvider } from "../noop-calendar-provider.js";
import { receiptTierForCalendarProvider } from "../receipt-tier.js";

const BUSINESS_HOURS = {
  timezone: "Asia/Singapore",
  days: [{ day: 1, open: "09:00", close: "18:00" }],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

function makeBookingStore() {
  return {
    findOverlapping: async () => [],
    createInTransaction: async () => ({ id: "booking_1" }),
    findById: async () => null,
    cancel: async () => undefined,
    reschedule: async () => ({ id: "booking_1" }),
  };
}

describe("receiptTierForCalendarProvider", () => {
  it("returns T3_ADMIN_AUDIT for NoopCalendarProvider (fabricates event ids)", () => {
    const provider = new NoopCalendarProvider();
    expect(receiptTierForCalendarProvider(provider)).toBe("T3_ADMIN_AUDIT");
  });

  it("returns T3_ADMIN_AUDIT for LocalCalendarProvider (fabricates local- event ids)", () => {
    const provider = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: makeBookingStore(),
    });
    expect(receiptTierForCalendarProvider(provider)).toBe("T3_ADMIN_AUDIT");
  });

  it("returns T1_FETCH_BACK for a real/external provider (e.g. Google)", () => {
    // Stub representing a real provider — no fabricated ids, fetch-back-verifiable.
    const realProvider: CalendarProvider = {
      listAvailableSlots: async () => [],
      createBooking: async () => ({}) as never,
      cancelBooking: async () => undefined,
      rescheduleBooking: async () => ({}) as never,
      getBooking: async () => null,
      healthCheck: async () => ({ status: "connected", latencyMs: 5 }),
    };
    expect(receiptTierForCalendarProvider(realProvider)).toBe("T1_FETCH_BACK");
  });
});
