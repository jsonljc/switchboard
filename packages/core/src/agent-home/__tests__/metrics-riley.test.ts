import { describe, expect, it, vi } from "vitest";
import { buildWeekContext } from "../metrics-buckets.js";
import { buildAlexMetricsViewModel } from "../metrics-alex.js";
import { buildRileyMetricsViewModel } from "../metrics-riley.js";
import type { MetricsSignalStore } from "../metrics.js";

const TZ = "Asia/Singapore";
const WED_NOW = new Date("2026-05-06T07:30:00.000Z");

function makeStore(opts: {
  leadsThisWeek?: number;
  leadsLastWeek?: number;
  leadsPerWeeklyBucket?: number[];
  leadsPerDailyBucket?: number[];
}): MetricsSignalStore {
  return {
    countBookingsCreated: vi.fn(async () => 0),
    countConversionsByType: vi.fn(async ({ from, to }) => {
      const week = buildWeekContext(WED_NOW, TZ);
      // Patch 1: discriminate hero (weekStart..weekEnd) from daily Mon bucket (weekStart..weekStart+DAY)
      // by checking both from and to.
      if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
        return opts.leadsThisWeek ?? 0;
      // Patch 2: prevWeekStart branch covers both heroPrev and weeklyBuckets[3] (same range).
      // leadsLastWeek is returned for both calls, which is semantically correct.
      if (from.getTime() === week.prevWeekStart.getTime()) return opts.leadsLastWeek ?? 0;
      const weeklyIdx = week.weeklyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
      if (weeklyIdx >= 0) return opts.leadsPerWeeklyBucket?.[weeklyIdx] ?? 0;
      const dailyIdx = week.dailyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
      if (dailyIdx >= 0) return opts.leadsPerDailyBucket?.[dailyIdx] ?? 0;
      return 0;
    }),
  };
}

describe("buildRileyMetricsViewModel", () => {
  it("hero.kind is 'ad-leads' from countConversionsByType('lead')", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 86, leadsLastWeek: 71 }),
    });
    expect(vm.hero.kind).toBe("ad-leads");
    if (vm.hero.kind !== "ad-leads") throw new Error();
    expect(vm.hero.value).toBe(86);
    expect(vm.hero.comparator).toEqual({ window: "week", value: 71 });
  });

  it("subprose: '+15 from last week.' when up", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 86, leadsLastWeek: 71 }),
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "+15 from last week." }]);
  });

  it("subprose: '-12 from last week.' when down", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 50, leadsLastWeek: 62 }),
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "-12 from last week." }]);
  });

  it("subprose: 'Flat vs last week.' when equal", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 71, leadsLastWeek: 71 }),
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Flat vs last week." }]);
  });

  it("stats[0] Leads value === hero value (mirror)", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 86 }),
    });
    expect(vm.stats[0]).toEqual({
      label: "Leads",
      display: "86",
      rawValue: 86,
      unit: "count",
    });
  });

  it("stats[1] CTR is unavailable (display '—', rawValue null)", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({}),
    });
    expect(vm.stats[1]).toEqual({
      label: "CTR",
      display: "—",
      rawValue: null,
      unit: "percent",
      unavailable: true,
    });
  });

  it("stats[2] Spend is unavailable", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
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

  it("freshness.unavailableSources is ['ad-platform-ctr','ad-platform-spend']", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({}),
    });
    expect(vm.freshness.unavailableSources).toEqual(["ad-platform-ctr", "ad-platform-spend"]);
  });

  it("sparkline has 4 weekly + 3 daily on Wednesday; last is projection", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({
        // Patch 2: weeklyBuckets[3] ("last week") has same range as prevWeek comparator.
        // Set leadsLastWeek: 71 so the mock returns 71 for both calls via the prevWeekStart branch.
        leadsLastWeek: 71,
        leadsPerWeeklyBucket: [52, 64, 71, 71],
        leadsPerDailyBucket: [12, 18, 22],
      }),
    });
    expect(vm.spark.map((p) => p.value)).toEqual([52, 64, 71, 71, 12, 18, 22]);
    expect(vm.spark[vm.spark.length - 1]!.isProjection).toBe(true);
  });
});

describe("voice divergence (Alex vs Riley)", () => {
  it("same +5 delta produces different prose", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const alexVm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store: {
        countBookingsCreated: vi.fn(async ({ from }) => {
          if (from.getTime() === week.weekStart.getTime()) return 14;
          if (from.getTime() === week.prevWeekStart.getTime()) return 9;
          return 0;
        }),
        countConversionsByType: vi.fn(async () => 0),
      },
    });
    const rileyVm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: {
        countBookingsCreated: vi.fn(async () => 0),
        countConversionsByType: vi.fn(async ({ from }) => {
          if (from.getTime() === week.weekStart.getTime()) return 14;
          if (from.getTime() === week.prevWeekStart.getTime()) return 9;
          return 0;
        }),
      },
    });
    expect(alexVm.heroSubProseSegments[0]?.text).toBe("Up from 9 last week.");
    expect(rileyVm.heroSubProseSegments[0]?.text).toBe("+5 from last week.");
    expect(alexVm.heroSubProseSegments[0]?.text).not.toBe(rileyVm.heroSubProseSegments[0]?.text);
  });
});
