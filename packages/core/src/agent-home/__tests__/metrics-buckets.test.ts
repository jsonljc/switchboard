import { describe, expect, it } from "vitest";
import { buildWeekContext } from "../metrics-buckets.js";

const TZ = "Asia/Singapore";

// Wednesday 2026-05-06 15:30 SGT (UTC+8) → UTC 07:30
const WED_NOW = new Date("2026-05-06T07:30:00.000Z");
// Monday 2026-05-04 09:00 SGT
const MON_NOW = new Date("2026-05-04T01:00:00.000Z");
// Sunday 2026-05-10 23:30 SGT
const SUN_NOW = new Date("2026-05-10T15:30:00.000Z");

describe("buildWeekContext", () => {
  it("on Wednesday: weekStart is Mon 00:00 SGT, weekEnd is Mon+7d", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    expect(w.weekStart.toISOString()).toBe("2026-05-03T16:00:00.000Z");
    expect(w.weekEnd.toISOString()).toBe("2026-05-10T16:00:00.000Z");
  });

  it("on Wednesday: prevWeek is the week before, exactly aligned to most-recent weekly bucket", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    expect(w.prevWeekStart.toISOString()).toBe("2026-04-26T16:00:00.000Z");
    expect(w.prevWeekEnd.toISOString()).toBe("2026-05-03T16:00:00.000Z");
    expect(w.weeklyBuckets[w.weeklyBuckets.length - 1]?.from.toISOString()).toBe(
      w.prevWeekStart.toISOString(),
    );
    expect(w.weeklyBuckets[w.weeklyBuckets.length - 1]?.to.toISOString()).toBe(
      w.prevWeekEnd.toISOString(),
    );
  });

  it("weekly buckets: 4 contiguous, ascending, non-overlapping", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    expect(w.weeklyBuckets).toHaveLength(4);
    for (let i = 1; i < w.weeklyBuckets.length; i++) {
      expect(w.weeklyBuckets[i]!.from.getTime()).toBe(w.weeklyBuckets[i - 1]!.to.getTime());
    }
    expect(w.weeklyBuckets[0]!.from.toISOString()).toBe("2026-04-05T16:00:00.000Z");
  });

  it("daily buckets: 1 on Monday, 3 on Wednesday, 7 on Sunday", () => {
    expect(buildWeekContext(MON_NOW, TZ).dailyBuckets).toHaveLength(1);
    expect(buildWeekContext(WED_NOW, TZ).dailyBuckets).toHaveLength(3);
    expect(buildWeekContext(SUN_NOW, TZ).dailyBuckets).toHaveLength(7);
  });

  it("today daily bucket has isToday=true, others false", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    expect(w.dailyBuckets[w.dailyBuckets.length - 1]!.isToday).toBe(true);
    expect(w.dailyBuckets[0]!.isToday).toBe(false);
  });

  it("daily bucket today.to equals now, today.from is local midnight", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    const today = w.dailyBuckets[w.dailyBuckets.length - 1]!;
    expect(today.to.toISOString()).toBe(WED_NOW.toISOString());
    expect(today.from.toISOString()).toBe("2026-05-05T16:00:00.000Z");
  });

  it("folioRange: Mon when today is Monday", () => {
    expect(buildWeekContext(MON_NOW, TZ).folioRange).toBe("Mon");
  });

  it("folioRange: 'Mon — Wed' on Wednesday", () => {
    expect(buildWeekContext(WED_NOW, TZ).folioRange).toBe("Mon — Wed");
  });

  it("folioRange: 'Mon — Sun' on Sunday", () => {
    expect(buildWeekContext(SUN_NOW, TZ).folioRange).toBe("Mon — Sun");
  });

  it("weekly bucket labels are descending in human terms (ascending in time)", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    expect(w.weeklyBuckets.map((b) => b.label)).toEqual([
      "4 wks ago",
      "3 wks ago",
      "2 wks ago",
      "last week",
    ]);
  });

  it("daily bucket labels match weekday short names", () => {
    const w = buildWeekContext(WED_NOW, TZ);
    expect(w.dailyBuckets.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed"]);
  });
});
