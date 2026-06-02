import { describe, expect, it, vi } from "vitest";
import type { MetricsSignalStore } from "../metrics.js";
import { projectMetrics } from "../metrics.js";

const TZ = "Asia/Singapore";
const NOW = new Date("2026-05-06T07:30:00.000Z"); // Wed 15:30 SGT
const DEFAULT_TARGETS = { avgValueCents: null, targetCpbCents: null };

function makeStore(): MetricsSignalStore {
  return {
    countBookingsCreated: vi.fn(async () => 0),
    countConversionsByType: vi.fn(async () => 0),
    getMetaSpendCents: vi.fn(async () => null),
    countCurrentlyAtStageUpdatedInWindow: vi.fn(async () => 0),
    latestOpportunityStageUpdatedAt: vi.fn(async () => null),
  };
}

describe("projectMetrics orchestrator", () => {
  it("dispatches to alex builder for agentKey='alex'", async () => {
    const vm = await projectMetrics({
      orgId: "org-1",
      agentKey: "alex",
      now: NOW,
      timezone: TZ,
      store: makeStore(),
      targets: DEFAULT_TARGETS,
    });
    expect(vm.hero.kind).toBe("appointments-booked");
  });

  it("dispatches to riley builder for agentKey='riley'", async () => {
    const vm = await projectMetrics({
      orgId: "org-1",
      agentKey: "riley",
      now: NOW,
      timezone: TZ,
      store: makeStore(),
      targets: DEFAULT_TARGETS,
    });
    expect(vm.hero.kind).toBe("ad-leads");
  });

  it("freshness.dataSource is 'live' and window is 'week'", async () => {
    const vm = await projectMetrics({
      orgId: "org-1",
      agentKey: "alex",
      now: NOW,
      timezone: TZ,
      store: makeStore(),
      targets: DEFAULT_TARGETS,
    });
    expect(vm.freshness.dataSource).toBe("live");
    expect(vm.freshness.window).toBe("week");
  });

  it("folioRange comes from WeekContext (Mon — Wed for Wednesday)", async () => {
    const vm = await projectMetrics({
      orgId: "org-1",
      agentKey: "alex",
      now: NOW,
      timezone: TZ,
      store: makeStore(),
      targets: DEFAULT_TARGETS,
    });
    expect(vm.folioRange).toBe("Mon — Wed");
  });
});
