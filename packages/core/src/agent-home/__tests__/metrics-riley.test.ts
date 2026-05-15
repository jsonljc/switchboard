import { describe, expect, it, vi } from "vitest";
import { buildWeekContext } from "../metrics-buckets.js";
import { buildAlexMetricsViewModel } from "../metrics-alex.js";
import { buildRileyMetricsViewModel } from "../metrics-riley.js";
import type { MetricsSignalStore } from "../metrics.js";

const TZ = "Asia/Singapore";
const WED_NOW = new Date("2026-05-06T07:30:00.000Z");

const DEFAULT_TARGETS = { avgValueCents: null, targetCpbCents: null };

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
    getMetaSpendCents: vi.fn(async () => null),
  };
}

describe("buildRileyMetricsViewModel", () => {
  it("hero.kind is 'ad-leads' from countConversionsByType('lead')", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 86, leadsLastWeek: 71 }),
      targets: DEFAULT_TARGETS,
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
      targets: DEFAULT_TARGETS,
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "+15 from last week." }]);
  });

  it("subprose: '12 fewer from last week.' when down", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 50, leadsLastWeek: 62 }),
      targets: DEFAULT_TARGETS,
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "12 fewer from last week." }]);
  });

  it("subprose: 'Flat vs last week.' when equal", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 71, leadsLastWeek: 71 }),
      targets: DEFAULT_TARGETS,
    });
    expect(vm.heroSubProseSegments).toEqual([{ kind: "text", text: "Flat vs last week." }]);
  });

  it("stats[0] Leads value === hero value (mirror)", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 86 }),
      targets: DEFAULT_TARGETS,
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
      targets: DEFAULT_TARGETS,
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

  it("freshness.unavailableSources is ['ad-platform-ctr','ad-platform-spend']", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({}),
      targets: DEFAULT_TARGETS,
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
      targets: DEFAULT_TARGETS,
    });
    expect(vm.spark.map((p) => p.value)).toEqual([52, 64, 71, 71, 12, 18, 22]);
    expect(vm.spark[vm.spark.length - 1]!.isProjection).toBe(true);
  });

  describe("A.3 echoes (Riley shares the shape)", () => {
    it("echoes targets and spendCents on Riley path", async () => {
      const store = makeStore({});
      const vm = await buildRileyMetricsViewModel({
        orgId: "org_1",
        week: buildWeekContext(WED_NOW, TZ),
        store,
        targets: { avgValueCents: 12000, targetCpbCents: 4000 },
      });
      expect(vm.targets).toEqual({ avgValueCents: 12000, targetCpbCents: 4000 });
      expect(vm.spendCents).toBeNull();
      expect(vm.leads).toBeGreaterThanOrEqual(0);
    });

    // Producer-side invariant: stats[2] (Spend) and unavailableSources must agree
    // with spendCents nullity. Catches the latent contract bug surfaced in PR #500
    // review (Important #4) where a future B.2b spend wiring could silently leave
    // stats[2].unavailable=true while emitting non-null spendCents.
    it("Spend stat-cell unavailable mirrors spendCents nullity (Riley)", async () => {
      const week = buildWeekContext(WED_NOW, TZ);
      const present = await buildRileyMetricsViewModel({
        orgId: "org-1",
        week,
        store: { ...makeStore({}), getMetaSpendCents: vi.fn(async () => 21400) },
        targets: DEFAULT_TARGETS,
      });
      expect(present.spendCents).toBe(21400);
      expect(present.stats[2].unavailable).toBe(false);
      expect(present.stats[2].display).toBe("$214");
      expect(present.stats[2].rawValue).toBe(21400);
      expect(present.freshness.unavailableSources).not.toContain("ad-platform-spend");

      const absent = await buildRileyMetricsViewModel({
        orgId: "org-1",
        week,
        store: makeStore({}),
        targets: DEFAULT_TARGETS,
      });
      expect(absent.spendCents).toBeNull();
      expect(absent.stats[2].unavailable).toBe(true);
      expect(absent.stats[2].display).toBe("—");
      expect(absent.freshness.unavailableSources).toContain("ad-platform-spend");
    });
  });
});

describe("buildRileyMetricsViewModel — tiles + roi (B.2b)", () => {
  const baseTargets = { avgValueCents: null, targetCpbCents: null };

  function tilesOf(vm: {
    tiles?: readonly {
      label: string;
      value: number | string;
      unavailable?: boolean;
      trend?: string;
      hint?: string;
    }[];
  }) {
    return vm.tiles ?? [];
  }

  it("emits exactly 3 tiles: leads / ctr / ad spend", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: baseTargets,
    });
    const tiles = tilesOf(vm);
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toEqual({ label: "leads", value: 27, trend: "+5" });
    expect(tiles[1]).toEqual({ label: "ctr", value: "—", unavailable: true });
    expect(tiles[2]).toEqual({ label: "ad spend", value: "$200" });
  });

  it("tile[2] degrades to unavailable + 'Connect Meta Ads' hint when spendCents is null", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 });
    // store already returns null for spend by default
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: baseTargets,
    });
    expect(tilesOf(vm)[2]).toEqual({
      label: "ad spend",
      value: "—",
      unavailable: true,
      hint: "Connect Meta Ads",
    });
  });

  it("roi rule 1: spendCents === null → 'Connect Meta Ads to see cost per lead'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 });
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: 500 },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "Connect Meta Ads to see cost per lead",
      label: "cost per lead",
      comparator: { value: "—", target: "target $5" },
    });
  });

  it("roi rule 2: spendCents > 0 && leads === 0 → empty hint, comparator '—'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 0, leadsLastWeek: 0 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: null },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "—", target: "—" },
    });
  });

  it("roi rule 3: spendCents > 0 && leads > 0 && targetCpbCents === null → comparator '$N per lead', target '—'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 10, leadsLastWeek: 0 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: null },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "$20 per lead", target: "—" },
    });
  });

  it("roi sub-dollar guard: cpl rounds to 0 → '<$1 per lead', not '$0 per lead'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 100, leadsLastWeek: 0 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(99);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: 500 },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "<$1 per lead", target: "target $5" },
    });
  });

  it("roi rule 4: spendCents > 0 && leads > 0 && targetCpbCents > 0 → live comparator + target", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 5, leadsLastWeek: 0 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(12345);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: 1000 },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "$25 per lead", target: "target $10" },
    });
  });

  it("preserves the flat-shape qualifiedPct=0 placeholder for backward compat", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 }),
      targets: baseTargets,
    });
    expect(vm.qualifiedPct).toBe(0);
    // tiles must not surface qualified
    expect(tilesOf(vm).map((t) => t.label)).not.toContain("qualified");
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
        getMetaSpendCents: vi.fn(async () => null),
      },
      targets: DEFAULT_TARGETS,
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
        getMetaSpendCents: vi.fn(async () => null),
      },
      targets: DEFAULT_TARGETS,
    });
    expect(alexVm.heroSubProseSegments[0]?.text).toBe("Up from 9 last week.");
    expect(rileyVm.heroSubProseSegments[0]?.text).toBe("+5 from last week.");
    expect(alexVm.heroSubProseSegments[0]?.text).not.toBe(rileyVm.heroSubProseSegments[0]?.text);
  });
});
