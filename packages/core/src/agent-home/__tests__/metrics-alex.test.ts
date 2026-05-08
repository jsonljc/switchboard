import { describe, expect, it, vi } from "vitest";
import { buildWeekContext } from "../metrics-buckets.js";
import { buildAlexMetricsViewModel } from "../metrics-alex.js";
import type { MetricsSignalStore } from "../metrics.js";

const TZ = "Asia/Singapore";
const WED_NOW = new Date("2026-05-06T07:30:00.000Z"); // Wed 15:30 SGT

function makeStore(opts: {
  toursThisWeek?: number;
  toursLastWeek?: number;
  toursPerWeeklyBucket?: number[];
  toursPerDailyBucket?: number[];
  leads?: number;
}): MetricsSignalStore {
  let bookingCalls = 0;
  return {
    countBookingsCreated: vi.fn(async ({ from, to }) => {
      bookingCalls += 1;
      const week = buildWeekContext(WED_NOW, TZ);
      // Full-week hero range (weekStart..weekEnd) must be checked before daily buckets
      // because dailyBuckets[0].from === weekStart.
      if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
        return opts.toursThisWeek ?? 0;
      // prevWeekStart..prevWeekEnd covers both heroPrev and weeklyBuckets[3] (same range).
      if (from.getTime() === week.prevWeekStart.getTime()) return opts.toursLastWeek ?? 0;
      const weeklyIdx = week.weeklyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
      if (weeklyIdx >= 0) return opts.toursPerWeeklyBucket?.[weeklyIdx] ?? 0;
      const dailyIdx = week.dailyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
      if (dailyIdx >= 0) return opts.toursPerDailyBucket?.[dailyIdx] ?? 0;
      throw new Error(`unexpected from=${from.toISOString()} (call #${bookingCalls})`);
    }),
    countConversionsByType: vi.fn(async () => opts.leads ?? 0),
  };
}

describe("buildAlexMetricsViewModel", () => {
  it("hero.kind is 'tours-booked' and value comes from the this-week count", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 14, toursLastWeek: 9 }),
    });
    expect(vm.hero.kind).toBe("tours-booked");
    if (vm.hero.kind !== "tours-booked") throw new Error();
    expect(vm.hero.value).toBe(14);
    expect(vm.hero.comparator).toEqual({ window: "week", value: 9 });
  });

  it("excludes 'cancelled' status when counting bookings", async () => {
    const store = makeStore({ toursThisWeek: 5 });
    const week = buildWeekContext(WED_NOW, TZ);
    await buildAlexMetricsViewModel({ orgId: "org-1", week, store });
    const calls = (store.countBookingsCreated as ReturnType<typeof vi.fn>).mock.calls;
    for (const [arg] of calls) {
      expect(arg.excludeStatuses).toEqual(["cancelled"]);
    }
  });

  it("subprose: 'Up from N last week' when up", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 14, toursLastWeek: 9 }),
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Up from 9 last week." }]);
  });

  it("subprose: 'Down from N last week' when down", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 5, toursLastWeek: 16 }),
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Down from 16 last week." }]);
  });

  it("subprose: 'Flat vs last week' when equal", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 9, toursLastWeek: 9 }),
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Flat vs last week." }]);
  });

  it("sparkline has 4 weekly + 3 daily points on Wednesday; last is isProjection", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({
        toursLastWeek: 9,
        toursPerWeeklyBucket: [7, 8, 9, 9],
        toursPerDailyBucket: [2, 5, 8],
      }),
    });
    expect(vm.spark).toHaveLength(7);
    expect(vm.spark.map((p) => p.value)).toEqual([7, 8, 9, 9, 2, 5, 8]);
    expect(vm.spark.map((p) => p.label)).toEqual([
      "4 wks ago",
      "3 wks ago",
      "2 wks ago",
      "last week",
      "Mon",
      "Tue",
      "Wed",
    ]);
    expect(vm.spark[vm.spark.length - 1]!.isProjection).toBe(true);
    expect(vm.spark[vm.spark.length - 2]!.isProjection).toBeUndefined();
  });

  it("stats[0] Leads = countConversionsByType('lead'); rawValue is the count", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 14, leads: 47 }),
    });
    expect(vm.stats[0]).toEqual({
      label: "Leads",
      display: "47",
      rawValue: 47,
      unit: "count",
    });
  });

  it("stats[1] Conversion = tours/leads as percent", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 14, leads: 50 }),
    });
    expect(vm.stats[1]).toEqual({
      label: "Conversion",
      display: "28%",
      rawValue: 0.28,
      unit: "percent",
    });
  });

  it("stats[1] Conversion is 0%/0 when leads=0 (no NaN)", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ toursThisWeek: 5, leads: 0 }),
    });
    expect(vm.stats[1]).toEqual({
      label: "Conversion",
      display: "0%",
      rawValue: 0,
      unit: "percent",
    });
  });

  it("stats[2] Spend is unavailable: display='—', rawValue=null, unavailable=true", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({}),
    });
    expect(vm.stats[2]).toEqual({
      label: "Spend",
      display: "—",
      rawValue: null,
      unit: "currency",
      unavailable: true,
    });
  });

  it("freshness.unavailableSources contains 'ad-platform-spend'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({}),
    });
    expect(vm.freshness.unavailableSources).toEqual(["ad-platform-spend"]);
    expect(vm.freshness.dataSource).toBe("live");
  });

  it("folioRange === 'Mon — Wed'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({}),
    });
    expect(vm.folioRange).toBe("Mon — Wed");
  });
});
