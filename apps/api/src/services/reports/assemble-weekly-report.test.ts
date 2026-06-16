import { describe, it, expect } from "vitest";
import { completedWeekRange } from "./assemble-weekly-report.js";

/**
 * completedWeekRange returns the most recent fully-elapsed Mon 00:00:00 .. Sun
 * 23:59:59.999 UTC week, exclusive-end at the following Monday 00:00:00.
 */
describe("completedWeekRange", () => {
  it("given a mid-week Wednesday, returns the prior Mon..Sun (the week that just completed)", () => {
    // Wed 2026-06-17 12:00 UTC. The week containing it (Mon Jun 15 .. Sun Jun 21) is
    // still in progress, so the most recent COMPLETED week is Mon Jun 8 .. Sun Jun 14.
    const now = new Date("2026-06-17T12:00:00.000Z");
    const { start, end } = completedWeekRange(now);

    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    // Exclusive end = next Monday 00:00:00 (Mon Jun 15).
    expect(end.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("given a Monday, returns the immediately preceding full week (not the in-progress one)", () => {
    // Mon 2026-06-15 09:00 UTC. The current week starts today, so the last completed
    // week is Mon Jun 8 .. Sun Jun 14.
    const now = new Date("2026-06-15T09:00:00.000Z");
    const { start, end } = completedWeekRange(now);

    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("given a Sunday late in the day, still returns the prior completed week", () => {
    // Sun 2026-06-21 23:30 UTC is the last day of the IN-PROGRESS week (Mon Jun 15..Sun Jun 21),
    // so the most recent completed week remains Mon Jun 8 .. Sun Jun 14.
    const now = new Date("2026-06-21T23:30:00.000Z");
    const { start, end } = completedWeekRange(now);

    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("spans exactly 7 days (exclusive end)", () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const { start, end } = completedWeekRange(now);
    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(7);
  });
});
