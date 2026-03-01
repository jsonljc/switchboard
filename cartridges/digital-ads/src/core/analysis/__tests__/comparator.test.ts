import { describe, it, expect } from "vitest";
import { buildComparisonPeriods, buildTrailingPeriods } from "../comparator.js";

// ---------------------------------------------------------------------------
// buildComparisonPeriods
// ---------------------------------------------------------------------------

describe("buildComparisonPeriods", () => {
  it("produces correct 7-day WoW periods", () => {
    // Reference date: Jan 14, 2024
    const ref = new Date("2024-01-14");
    const periods = buildComparisonPeriods(ref, 7);

    expect(periods.current).toEqual({
      since: "2024-01-08",
      until: "2024-01-14",
    });
    expect(periods.previous).toEqual({
      since: "2024-01-01",
      until: "2024-01-07",
    });
  });

  it("handles 1-day comparison periods", () => {
    const ref = new Date("2024-03-10");
    const periods = buildComparisonPeriods(ref, 1);

    expect(periods.current).toEqual({
      since: "2024-03-10",
      until: "2024-03-10",
    });
    expect(periods.previous).toEqual({
      since: "2024-03-09",
      until: "2024-03-09",
    });
  });

  it("handles 14-day comparison periods", () => {
    const ref = new Date("2024-02-28");
    const periods = buildComparisonPeriods(ref, 14);

    expect(periods.current).toEqual({
      since: "2024-02-15",
      until: "2024-02-28",
    });
    expect(periods.previous).toEqual({
      since: "2024-02-01",
      until: "2024-02-14",
    });
  });

  it("handles cross-month boundaries", () => {
    const ref = new Date("2024-02-03");
    const periods = buildComparisonPeriods(ref, 7);

    expect(periods.current).toEqual({
      since: "2024-01-28",
      until: "2024-02-03",
    });
    expect(periods.previous).toEqual({
      since: "2024-01-21",
      until: "2024-01-27",
    });
  });
});

// ---------------------------------------------------------------------------
// buildTrailingPeriods
// ---------------------------------------------------------------------------

describe("buildTrailingPeriods", () => {
  it("produces correct number of trailing periods", () => {
    const ref = new Date("2024-01-28");
    const periods = buildTrailingPeriods(ref, 7, 4);

    expect(periods).toHaveLength(4);
  });

  it("produces periods in most-recent-first order", () => {
    const ref = new Date("2024-01-28");
    const periods = buildTrailingPeriods(ref, 7, 3);

    // Most recent first
    expect(periods[0]).toEqual({
      since: "2024-01-22",
      until: "2024-01-28",
    });
    expect(periods[1]).toEqual({
      since: "2024-01-15",
      until: "2024-01-21",
    });
    expect(periods[2]).toEqual({
      since: "2024-01-08",
      until: "2024-01-14",
    });
  });

  it("periods are contiguous (no gaps or overlaps)", () => {
    const ref = new Date("2024-03-31");
    const periods = buildTrailingPeriods(ref, 7, 5);

    for (let i = 0; i < periods.length - 1; i++) {
      const currentStart = new Date(periods[i].since);
      const nextEnd = new Date(periods[i + 1].until);
      // The day before the current period's start should equal the next period's end
      currentStart.setDate(currentStart.getDate() - 1);
      expect(currentStart.toISOString().slice(0, 10)).toBe(
        nextEnd.toISOString().slice(0, 10)
      );
    }
  });

  it("handles count of 0", () => {
    const ref = new Date("2024-01-28");
    const periods = buildTrailingPeriods(ref, 7, 0);
    expect(periods).toHaveLength(0);
  });

  it("handles 1-day periods", () => {
    const ref = new Date("2024-01-05");
    const periods = buildTrailingPeriods(ref, 1, 3);

    expect(periods).toHaveLength(3);
    expect(periods[0]).toEqual({ since: "2024-01-05", until: "2024-01-05" });
    expect(periods[1]).toEqual({ since: "2024-01-04", until: "2024-01-04" });
    expect(periods[2]).toEqual({ since: "2024-01-03", until: "2024-01-03" });
  });
});
