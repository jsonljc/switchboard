import { describe, it, expect } from "vitest";
import { dayWindow, previousDayWindow } from "../time-windows.js";

describe("dayWindow", () => {
  it("returns UTC-midnight-to-next-UTC-midnight for a mid-afternoon UTC timestamp", () => {
    const at = new Date("2026-05-01T14:30:00Z");
    const { from, to } = dayWindow(at);
    expect(from.getUTCHours()).toBe(0);
    expect(from.getUTCMinutes()).toBe(0);
    expect(from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("returns same window when called twice with timestamps from the same UTC day", () => {
    const a = dayWindow(new Date("2026-05-01T01:00:00Z"));
    const b = dayWindow(new Date("2026-05-01T23:59:59Z"));
    expect(a.from.getTime()).toBe(b.from.getTime());
    expect(a.to.getTime()).toBe(b.to.getTime());
  });

  it("does not mutate the input", () => {
    const at = new Date("2026-05-01T14:30:00Z");
    const original = at.getTime();
    dayWindow(at);
    expect(at.getTime()).toBe(original);
  });
});

describe("previousDayWindow", () => {
  it("returns the UTC day-window directly preceding today's", () => {
    const at = new Date("2026-05-01T14:30:00Z");
    const today = dayWindow(at);
    const yesterday = previousDayWindow(at);
    expect(yesterday.to.getTime()).toBe(today.from.getTime());
    expect(today.from.getTime() - yesterday.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
