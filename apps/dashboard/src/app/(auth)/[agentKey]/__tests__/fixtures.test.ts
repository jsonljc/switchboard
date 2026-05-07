// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { getFixtureGreeting, getFixturePipeline } from "../_fixtures";

describe("agent-home fixtures", () => {
  it.each(["alex", "riley"] as const)("%s greeting fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureGreeting(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.segments.length).toBeGreaterThan(0);
  });

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
