// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { getFixtureGreeting, getFixtureMetrics } from "../_fixtures";

describe("agent-home fixtures", () => {
  it.each(["alex", "riley"] as const)("%s greeting fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureGreeting(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.segments.length).toBeGreaterThan(0);
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
});
