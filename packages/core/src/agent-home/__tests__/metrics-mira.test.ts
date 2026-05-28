import { describe, expect, it } from "vitest";
import { buildMiraMetricsViewModel } from "../metrics-mira.js";
import { projectMetrics } from "../metrics.js";
import { buildWeekContext } from "../metrics-buckets.js";

const week = buildWeekContext(new Date("2026-05-28T12:00:00Z"), "UTC");

describe("buildMiraMetricsViewModel", () => {
  it("hero is creatives-shipped with week-over-week comparator", () => {
    const vm = buildMiraMetricsViewModel({
      counts: {
        total: 7,
        shippedThisWeek: 3,
        shippedPrevWeek: 1,
        inFlight: 4,
        awaitingReview: 2,
        stopped: 1,
      },
      week,
    });
    expect(vm.hero).toEqual({
      kind: "creatives-shipped",
      value: 3,
      comparator: { window: "week", value: 1 },
    });
    expect(vm.stats).toHaveLength(3);
    expect(vm.stats.map((s) => s.label)).toEqual([
      "Drafts completed",
      "Awaiting review",
      "In flight",
    ]);
    expect(vm.freshness.window).toBe("week");
  });

  it("zero counts → neutral hero and stats", () => {
    const vm = buildMiraMetricsViewModel({
      counts: {
        total: 0,
        shippedThisWeek: 0,
        shippedPrevWeek: 0,
        inFlight: 0,
        awaitingReview: 0,
        stopped: 0,
      },
      week,
    });
    expect(vm.hero.value).toBe(0);
    expect(vm.stats[0]!.display).toBe("0");
  });
});

describe("projectMetrics — mira partial-wiring guard", () => {
  it("throws when agentKey 'mira' but miraReader is missing", async () => {
    await expect(
      projectMetrics({
        orgId: "o",
        agentKey: "mira",
        now: new Date("2026-05-28T12:00:00Z"),
        timezone: "UTC",
        store: {} as never,
        targets: { avgValueCents: null, targetCpbCents: null },
      }),
    ).rejects.toThrow(/miraReader required/);
  });
});
