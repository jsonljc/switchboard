import { describe, expect, it, vi } from "vitest";
import { buildWeekContext } from "../metrics-buckets.js";
import { buildAlexMetricsViewModel } from "../metrics-alex.js";
import type { MetricsSignalStore } from "../metrics.js";

const TZ = "Asia/Singapore";
const WED_NOW = new Date("2026-05-06T07:30:00.000Z"); // Wed 15:30 SGT

function makeStore(overrides?: {
  bookingsByRange?: (from: Date, to: Date) => number;
  leadsByRange?: (from: Date, to: Date) => number;
  spendCents?: number | null;
  showedByRange?: (from: Date, to: Date) => number;
  boardLastUpdated?: Date | null;
}): MetricsSignalStore {
  let bookingCalls = 0;
  return {
    countBookingsCreated: vi.fn(async ({ from, to }) => {
      bookingCalls += 1;
      const week = buildWeekContext(WED_NOW, TZ);
      if (overrides?.bookingsByRange) {
        return overrides.bookingsByRange(from, to);
      }
      // Full-week hero range (weekStart..weekEnd) must be checked before daily buckets
      // because dailyBuckets[0].from === weekStart.
      if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
        return 0;
      // prevWeekStart..prevWeekEnd covers both heroPrev and weeklyBuckets[3] (same range).
      if (from.getTime() === week.prevWeekStart.getTime()) return 0;
      const weeklyIdx = week.weeklyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
      if (weeklyIdx >= 0) return 0;
      const dailyIdx = week.dailyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
      if (dailyIdx >= 0) return 0;
      throw new Error(`unexpected from=${from.toISOString()} (call #${bookingCalls})`);
    }),
    countConversionsByType: vi.fn(async ({ from, to }) => {
      if (overrides?.leadsByRange) {
        return overrides.leadsByRange(from, to);
      }
      return 0;
    }),
    getMetaSpendCents: vi.fn(async () => overrides?.spendCents ?? null),
    countCurrentlyAtStageUpdatedInWindow: vi.fn(async ({ from, to }) =>
      overrides?.showedByRange ? overrides.showedByRange(from, to) : 0,
    ),
    latestOpportunityStageUpdatedAt: vi.fn(async () => overrides?.boardLastUpdated ?? null),
  };
}

const DEFAULT_TARGETS = { avgValueCents: null, targetCpbCents: null };

function makeInput(
  store: MetricsSignalStore,
  targets: { avgValueCents: number | null; targetCpbCents: number | null } = DEFAULT_TARGETS,
) {
  const now = WED_NOW;
  const week = buildWeekContext(now, TZ);
  return { orgId: "org-1", week, store, targets };
}

describe("buildAlexMetricsViewModel", () => {
  it("hero.kind is 'appointments-booked' and value comes from the this-week count", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({
      bookingsByRange: (from, to) => {
        if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
          return 14;
        if (from.getTime() === week.prevWeekStart.getTime()) return 9;
        return 0;
      },
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.hero.kind).toBe("appointments-booked");
    if (vm.hero.kind !== "appointments-booked") throw new Error();
    expect(vm.hero.value).toBe(14);
    expect(vm.hero.comparator).toEqual({ window: "week", value: 9 });
  });

  it("excludes 'cancelled' and 'failed' statuses when counting bookings", async () => {
    const store = makeStore();
    const week = buildWeekContext(WED_NOW, TZ);
    await buildAlexMetricsViewModel({ orgId: "org-1", week, store, targets: DEFAULT_TARGETS });
    const calls = (store.countBookingsCreated as ReturnType<typeof vi.fn>).mock.calls;
    for (const [arg] of calls) {
      expect(arg.excludeStatuses).toEqual(["cancelled", "failed"]);
    }
  });

  it("subprose: 'Up from N last week' when up", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({
      bookingsByRange: (from, to) => {
        if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
          return 14;
        if (from.getTime() === week.prevWeekStart.getTime()) return 9;
        return 0;
      },
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Up from 9 last week." }]);
  });

  it("subprose: 'Down from N last week' when down", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({
      bookingsByRange: (from, to) => {
        if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
          return 5;
        if (from.getTime() === week.prevWeekStart.getTime()) return 16;
        return 0;
      },
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Down from 16 last week." }]);
  });

  it("subprose: 'Flat vs last week' when equal", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({
      bookingsByRange: () => 9,
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Flat vs last week." }]);
  });

  it("sparkline has 4 weekly + 3 daily points on Wednesday; last is isProjection", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const bookingsPerWeeklyBucket = [7, 8, 9, 9];
    const bookingsPerDailyBucket = [2, 5, 8];
    const store = makeStore({
      bookingsByRange: (from, to) => {
        // full-week hero
        if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
          return 0;
        // prevWeek (heroPrev + weeklyBuckets[3] both use same range)
        if (from.getTime() === week.prevWeekStart.getTime()) return 9;
        const weeklyIdx = week.weeklyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
        if (weeklyIdx >= 0) return bookingsPerWeeklyBucket[weeklyIdx] ?? 0;
        const dailyIdx = week.dailyBuckets.findIndex((b) => b.from.getTime() === from.getTime());
        if (dailyIdx >= 0) return bookingsPerDailyBucket[dailyIdx] ?? 0;
        return 0;
      },
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
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
    const store = makeStore({
      bookingsByRange: (from, to) => {
        if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
          return 14;
        return 0;
      },
      leadsByRange: () => 47,
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.stats[0]).toEqual({
      label: "Leads",
      display: "47",
      rawValue: 47,
      unit: "count",
    });
  });

  it("stats[1] Showed = operator-confirmed showed count + coverage% of booked", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({
      bookingsByRange: (from, to) =>
        from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime()
          ? 10
          : 0,
      showedByRange: () => 7,
      boardLastUpdated: new Date("2026-05-06T00:00:00.000Z"),
    });
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.stats[1].label).toBe("Showed");
    expect(vm.stats[1].display).toBe("7 (70%)");
    expect(vm.stats[1].rawValue).toBe(0.7);
    expect(vm.stats[1].unavailable).toBe(false);
    expect(vm.stats[1].hint).toBe("Operator-confirmed · board updated 2026-05-06");
  });

  it("stats[1] Showed is unavailable when the board was never updated", async () => {
    const store = makeStore({
      bookingsByRange: () => 10,
      showedByRange: () => 0,
      boardLastUpdated: null,
    });
    const vm = await buildAlexMetricsViewModel(makeInput(store));
    expect(vm.stats[1].display).toBe("—");
    expect(vm.stats[1].unavailable).toBe(true);
    expect(vm.stats[1].rawValue).toBeNull();
  });

  it("stats[2] Spend is unavailable: display='—', rawValue=null, unavailable=true", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore();
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
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
    const store = makeStore();
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.freshness.unavailableSources).toEqual(["ad-platform-spend"]);
    expect(vm.freshness.dataSource).toBe("live");
  });

  it("folioRange === 'Mon — Wed'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore();
    const vm = await buildAlexMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: DEFAULT_TARGETS,
    });
    expect(vm.folioRange).toBe("Mon — Wed");
  });

  describe("A.3 echoes", () => {
    it("echoes targets verbatim onto the view-model", async () => {
      const store = makeStore();
      const vm = await buildAlexMetricsViewModel(
        makeInput(store, { avgValueCents: 17900, targetCpbCents: 3000 }),
      );
      expect(vm.targets).toEqual({ avgValueCents: 17900, targetCpbCents: 3000 });
    });

    it("emits spendCents from the store when present, null when absent", async () => {
      const present = await buildAlexMetricsViewModel(makeInput(makeStore({ spendCents: 21400 })));
      expect(present.spendCents).toBe(21400);

      const absent = await buildAlexMetricsViewModel(makeInput(makeStore()));
      expect(absent.spendCents).toBeNull();
    });

    it("Spend stat-cell unavailable mirrors spendCents nullity", async () => {
      const present = await buildAlexMetricsViewModel(makeInput(makeStore({ spendCents: 21400 })));
      const spend = present.stats[2];
      expect(spend.unavailable).toBe(false);
      expect(spend.display).toBe("$214");
      expect(spend.rawValue).toBe(21400);

      const absent = await buildAlexMetricsViewModel(makeInput(makeStore()));
      expect(absent.stats[2].unavailable).toBe(true);
      expect(absent.stats[2].display).toBe("—");
    });

    it("computes deltas with sign prefix", async () => {
      // up
      const upStore = makeStore({
        bookingsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 9 : 6),
        leadsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 47 : 35),
      });
      const up = await buildAlexMetricsViewModel(makeInput(upStore));
      expect(up.bookedDelta).toBe("+3");
      expect(up.leadsDelta).toBe("+12");
      expect(up.qualifiedDelta).not.toBeNull();

      // flat
      const flat = await buildAlexMetricsViewModel(
        makeInput(makeStore({ bookingsByRange: () => 5, leadsByRange: () => 10 })),
      );
      expect(flat.bookedDelta).toBe("0");
      expect(flat.leadsDelta).toBe("0");

      // down
      const downStore = makeStore({
        bookingsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 4 : 10),
        leadsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 30 : 50),
      });
      const down = await buildAlexMetricsViewModel(makeInput(downStore));
      expect(down.bookedDelta).toBe("-6");
      expect(down.leadsDelta).toBe("-20");
    });

    it("echoes leads and qualifiedPct as top-level fields", async () => {
      const vm = await buildAlexMetricsViewModel(
        makeInput(makeStore({ bookingsByRange: () => 9, leadsByRange: () => 47 })),
      );
      expect(vm.leads).toBe(47);
      expect(vm.qualifiedPct).toBe(Math.round((9 / 47) * 100));
    });

    it("echoes showed and showCoverage as top-level fields", async () => {
      const week = buildWeekContext(WED_NOW, TZ);
      const store = makeStore({
        bookingsByRange: (from, to) =>
          from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime()
            ? 10
            : 0,
        showedByRange: () => 7,
        boardLastUpdated: new Date("2026-05-06T00:00:00.000Z"),
      });
      const vm = await buildAlexMetricsViewModel({
        orgId: "org-1",
        week,
        store,
        targets: DEFAULT_TARGETS,
      });
      expect(vm.showed).toBe(7);
      expect(vm.showCoverage).toBe(0.7);
    });

    it("qualifiedDelta returns null when prior leads = 0 (no comparator)", async () => {
      const vm = await buildAlexMetricsViewModel(
        makeInput(
          makeStore({
            bookingsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 9 : 0),
            leadsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 47 : 0),
          }),
        ),
      );
      expect(vm.qualifiedDelta).toBeNull();
    });
  });
});

function up_currentWeekStart(): number {
  return buildWeekContext(WED_NOW, TZ).weekStart.getTime();
}
