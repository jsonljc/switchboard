import { describe, expect, it } from "vitest";
import { computeWindowStart } from "../window.js";

describe("computeWindowStart", () => {
  describe("Asia/Singapore (UTC+8)", () => {
    const tz = "Asia/Singapore";
    // 2026-05-07 14:30 SGT = 2026-05-07 06:30 UTC
    const now = new Date("2026-05-07T06:30:00.000Z");

    it("today: returns local midnight", () => {
      const got = computeWindowStart("today", now, tz);
      // 2026-05-07 00:00 SGT = 2026-05-06 16:00 UTC
      expect(got.toISOString()).toBe("2026-05-06T16:00:00.000Z");
    });

    it("week: returns Monday 00:00 local", () => {
      // 2026-05-07 is Thursday; Monday is 2026-05-04
      const got = computeWindowStart("week", now, tz);
      // 2026-05-04 00:00 SGT = 2026-05-03 16:00 UTC
      expect(got.toISOString()).toBe("2026-05-03T16:00:00.000Z");
    });

    it("month: returns first of month 00:00 local", () => {
      const got = computeWindowStart("month", now, tz);
      // 2026-05-01 00:00 SGT = 2026-04-30 16:00 UTC
      expect(got.toISOString()).toBe("2026-04-30T16:00:00.000Z");
    });
  });

  describe("America/New_York (DST-spanning)", () => {
    const tz = "America/New_York";
    // 2026-03-09 10:00 EDT = 2026-03-09 14:00 UTC (day after spring-forward)
    const now = new Date("2026-03-09T14:00:00.000Z");

    it("today after DST spring-forward: midnight is local", () => {
      const got = computeWindowStart("today", now, tz);
      // 2026-03-09 00:00 EDT = 2026-03-09 04:00 UTC
      expect(got.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    });

    it("week spans DST boundary correctly", () => {
      // Monday is 2026-03-09 itself (the spring-forward Sunday is 03-08)
      const got = computeWindowStart("week", now, tz);
      expect(got.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    });
  });

  it("Sunday is treated as part of the prior week (week starts Monday)", () => {
    // 2026-05-10 is Sunday in SGT
    const sunday = new Date("2026-05-10T06:00:00.000Z"); // 14:00 SGT
    const got = computeWindowStart("week", sunday, "Asia/Singapore");
    // Prior Monday = 2026-05-04
    expect(got.toISOString()).toBe("2026-05-03T16:00:00.000Z");
  });
});
