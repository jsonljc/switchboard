import { describe, it, expect } from "vitest";
import { generateAvailableSlots } from "./slot-generator.js";
import type { BusinessHoursConfig } from "@switchboard/schemas";

const businessHours: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "17:00" },
    { day: 2, open: "09:00", close: "17:00" },
    { day: 3, open: "09:00", close: "17:00" },
    { day: 4, open: "09:00", close: "17:00" },
    { day: 5, open: "09:00", close: "17:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};

describe("generateAvailableSlots", () => {
  it("generates slots within business hours on a Monday", () => {
    // 2026-04-20 is a Monday
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods: [],
      calendarId: "primary",
    });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.available).toBe(true);
      expect(slot.calendarId).toBe("primary");
    }
  });

  it("excludes busy periods", () => {
    // Block 10:00-12:00 SGT (02:00-04:00 UTC)
    const busyPeriods = [{ start: "2026-04-20T02:00:00Z", end: "2026-04-20T04:00:00Z" }];
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods,
      calendarId: "primary",
    });

    for (const slot of slots) {
      const start = new Date(slot.start).getTime();
      const end = new Date(slot.end).getTime();
      const busyStart = new Date("2026-04-20T02:00:00Z").getTime();
      const busyEnd = new Date("2026-04-20T04:00:00Z").getTime();
      expect(start >= busyEnd || end <= busyStart).toBe(true);
    }
  });

  it("returns empty array for weekend days with no business hours", () => {
    // 2026-04-19 is a Sunday
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-19T00:00:00+08:00",
      dateTo: "2026-04-19T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods: [],
      calendarId: "primary",
    });

    expect(slots).toHaveLength(0);
  });

  it("respects buffer between slots", () => {
    const slots = generateAvailableSlots({
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      bufferMinutes: 15,
      businessHours,
      busyPeriods: [],
      calendarId: "primary",
    });

    for (let i = 1; i < slots.length; i++) {
      const prevEnd = new Date(slots[i - 1]!.end).getTime();
      const currStart = new Date(slots[i]!.start).getTime();
      const gapMinutes = (currStart - prevEnd) / 60_000;
      expect(gapMinutes).toBeGreaterThanOrEqual(15);
    }
  });
});
