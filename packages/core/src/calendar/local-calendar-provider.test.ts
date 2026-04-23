import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalCalendarProvider } from "./local-calendar-provider.js";
import type { BusinessHoursConfig, SlotQuery } from "@switchboard/schemas";

const BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "18:00" },
    { day: 2, open: "09:00", close: "18:00" },
    { day: 3, open: "09:00", close: "18:00" },
    { day: 4, open: "09:00", close: "18:00" },
    { day: 5, open: "09:00", close: "18:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

function makeBookingStore() {
  return {
    findOverlapping: vi.fn().mockResolvedValue([]),
    createInTransaction: vi.fn().mockResolvedValue({ id: "booking_1" }),
    findById: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(undefined),
    reschedule: vi.fn().mockResolvedValue({ id: "booking_1" }),
  };
}

describe("LocalCalendarProvider", () => {
  let store: ReturnType<typeof makeBookingStore>;
  let provider: LocalCalendarProvider;

  beforeEach(() => {
    store = makeBookingStore();
    provider = new LocalCalendarProvider({
      businessHours: BUSINESS_HOURS,
      bookingStore: store,
    });
  });

  describe("listAvailableSlots", () => {
    it("generates slots from business hours for a weekday", async () => {
      const query: SlotQuery = {
        dateFrom: "2026-04-27T00:00:00+08:00",
        dateTo: "2026-04-27T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      const slots = await provider.listAvailableSlots(query);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every((s) => s.available)).toBe(true);
      expect(slots.every((s) => s.calendarId === "local")).toBe(true);
    });

    it("returns no slots for a weekend (Saturday)", async () => {
      const query: SlotQuery = {
        dateFrom: "2026-04-25T00:00:00+08:00",
        dateTo: "2026-04-25T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      const slots = await provider.listAvailableSlots(query);
      expect(slots).toHaveLength(0);
    });

    it("excludes slots that overlap with existing bookings", async () => {
      store.findOverlapping.mockResolvedValue([
        {
          startsAt: new Date("2026-04-27T01:00:00Z"),
          endsAt: new Date("2026-04-27T01:30:00Z"),
        },
      ]);
      const query: SlotQuery = {
        dateFrom: "2026-04-27T09:00:00+08:00",
        dateTo: "2026-04-27T10:00:00+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
        bufferMinutes: 15,
      };
      const slots = await provider.listAvailableSlots(query);
      const hasOverlapping = slots.some((s) => {
        const start = new Date(s.start).getTime();
        const end = new Date(s.end).getTime();
        const busyStart = new Date("2026-04-27T01:00:00Z").getTime();
        const busyEnd = new Date("2026-04-27T01:30:00Z").getTime();
        return start < busyEnd && end > busyStart;
      });
      expect(hasOverlapping).toBe(false);
    });
  });

  describe("createBooking", () => {
    it("creates a booking with local- prefixed calendarEventId", async () => {
      const result = await provider.createBooking({
        contactId: "c1",
        organizationId: "org1",
        slot: {
          start: "2026-04-27T09:00:00+08:00",
          end: "2026-04-27T09:30:00+08:00",
          calendarId: "local",
          available: true,
        },
        service: "consultation",
        createdByType: "agent",
      });
      expect(result.calendarEventId).toMatch(/^local-/);
      expect(result.status).toBe("confirmed");
      expect(store.createInTransaction).toHaveBeenCalled();
    });

    it("throws when slot conflicts with existing booking", async () => {
      store.createInTransaction.mockRejectedValue(new Error("SLOT_CONFLICT"));
      await expect(
        provider.createBooking({
          contactId: "c1",
          organizationId: "org1",
          slot: {
            start: "2026-04-27T09:00:00+08:00",
            end: "2026-04-27T09:30:00+08:00",
            calendarId: "local",
            available: true,
          },
          service: "consultation",
          createdByType: "agent",
        }),
      ).rejects.toThrow("SLOT_CONFLICT");
    });
  });

  describe("healthCheck", () => {
    it("returns degraded status", async () => {
      const health = await provider.healthCheck();
      expect(health.status).toBe("degraded");
      expect(health.latencyMs).toBe(0);
    });
  });

  describe("getBooking", () => {
    it("delegates to store", async () => {
      store.findById.mockResolvedValue({ id: "b1", status: "confirmed" });
      const result = await provider.getBooking("b1");
      expect(result).toBeTruthy();
      expect(store.findById).toHaveBeenCalledWith("b1");
    });
  });
});
