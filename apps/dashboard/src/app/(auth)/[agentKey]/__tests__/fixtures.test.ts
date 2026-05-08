// apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { getFixtureGreeting } from "../_fixtures";

describe("agent-home fixtures", () => {
  it.each(["alex", "riley"] as const)("%s greeting fixture has dataSource fixture", (agentKey) => {
    const vm = getFixtureGreeting(agentKey);
    expect(vm.freshness.dataSource).toBe("fixture");
    expect(vm.segments.length).toBeGreaterThan(0);
  });
});
