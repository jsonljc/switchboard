import { describe, it, expect } from "vitest";
import { dayWindow, previousDayWindow } from "../time-windows.js";

describe("dayWindow", () => {
  it("returns midnight-to-next-midnight for a mid-afternoon timestamp", () => {
    const at = new Date("2026-05-01T14:30:00");
    const { from, to } = dayWindow(at);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("returns same window when called twice with timestamps from the same day", () => {
    const a = dayWindow(new Date("2026-05-01T01:00:00"));
    const b = dayWindow(new Date("2026-05-01T23:59:59"));
    expect(a.from.getTime()).toBe(b.from.getTime());
    expect(a.to.getTime()).toBe(b.to.getTime());
  });

  it("does not mutate the input", () => {
    const at = new Date("2026-05-01T14:30:00");
    const original = at.getTime();
    dayWindow(at);
    expect(at.getTime()).toBe(original);
  });
});

describe("previousDayWindow", () => {
  it("returns the day-window directly preceding today's", () => {
    const at = new Date("2026-05-01T14:30:00");
    const today = dayWindow(at);
    const yesterday = previousDayWindow(at);
    expect(yesterday.to.getTime()).toBe(today.from.getTime());
    expect(today.from.getTime() - yesterday.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
