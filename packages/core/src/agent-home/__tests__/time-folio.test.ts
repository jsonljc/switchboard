import { describe, expect, it } from "vitest";
import { formatTimeFolio } from "../time-folio.js";

describe("formatTimeFolio (Asia/Singapore)", () => {
  const tz = "Asia/Singapore";
  // Reference: 2026-05-07 (Thu) 14:30 SGT = 2026-05-07T06:30:00Z
  const now = new Date("2026-05-07T06:30:00.000Z");

  it("renders same-day as 12-hour with AM/PM", () => {
    // 2026-05-07 11:42 SGT = 2026-05-07T03:42:00Z
    const t = new Date("2026-05-07T03:42:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("11:42 AM");
  });

  it('renders "Yesterday · h:mm AM/PM" for prior day', () => {
    // 2026-05-06 18:14 SGT = 2026-05-06T10:14:00Z
    const t = new Date("2026-05-06T10:14:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("Yesterday · 6:14 PM");
  });

  it('renders "Wkd · h:mm AM/PM" earlier in the same week (Mon-Sun)', () => {
    // 2026-05-04 (Mon) 09:00 SGT = 2026-05-04T01:00:00Z
    const t = new Date("2026-05-04T01:00:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("Mon · 9:00 AM");
  });

  it('renders "Mon DD · h:mm AM/PM" for older than this week', () => {
    // 2026-05-03 (Sun, prior week) 11:42 SGT = 2026-05-03T03:42:00Z
    const t = new Date("2026-05-03T03:42:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("May 3 · 11:42 AM");
  });

  it("midnight prints as 12:00 AM", () => {
    // 2026-05-07 00:00 SGT = 2026-05-06T16:00:00Z
    const t = new Date("2026-05-06T16:00:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("12:00 AM");
  });

  it("noon prints as 12:00 PM", () => {
    // 2026-05-07 12:00 SGT = 2026-05-07T04:00:00Z
    const t = new Date("2026-05-07T04:00:00.000Z");
    expect(formatTimeFolio(t, now, tz)).toBe("12:00 PM");
  });

  it("respects America/New_York", () => {
    // now: 2026-05-07 02:30 EDT = 2026-05-07T06:30:00Z
    // t:   2026-05-07 01:42 EDT = 2026-05-07T05:42:00Z
    const t = new Date("2026-05-07T05:42:00.000Z");
    expect(formatTimeFolio(t, now, "America/New_York")).toBe("1:42 AM");
  });
});
