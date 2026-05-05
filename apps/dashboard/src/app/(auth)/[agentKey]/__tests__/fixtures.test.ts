// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts
import { describe, expect, it } from "vitest";
import {
  getFixtureGreeting,
  getFixtureWins,
  getFixtureMetrics,
  getFixturePipeline,
} from "../_fixtures";

describe("agent-home fixtures", () => {
  it.each(["alex", "riley"] as const)("%s greeting fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureGreeting(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.segments.length).toBeGreaterThan(0);
  });

  it.each(["alex", "riley"] as const)("%s wins fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureWins(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.wins.length).toBeGreaterThan(0);
    expect(vm.wins.every((w) => w.agentKey === agentKey)).toBe(true);
  });

  it.each(["alex", "riley"] as const)(
    "%s metrics fixture has 3 stats and dataSource fixture",
    (agentKey) => {
      const vm = getFixtureMetrics(agentKey);
      expect(vm.freshness.dataSource).toBe("fixture");
      expect(vm.stats).toHaveLength(3);
      expect(vm.spark.length).toBeGreaterThan(0);
    },
  );

  it("alex pipeline fixture is `leads`", () => {
    const vm = getFixturePipeline("alex");
    expect(vm.pipelineKind).toBe("leads");
    expect(vm.countNoun).toBe("people");
    expect(vm.freshness.dataSource).toBe("fixture");
  });

  it("riley pipeline fixture is `ad-sets`", () => {
    const vm = getFixturePipeline("riley");
    expect(vm.pipelineKind).toBe("ad-sets");
    expect(vm.countNoun).toBe("ad sets");
  });
});
