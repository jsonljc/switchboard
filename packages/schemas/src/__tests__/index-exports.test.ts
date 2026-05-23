import { describe, expect, it } from "vitest";
import * as schemas from "../index.js";

describe("schemas index exports", () => {
  it("exports dashboard onboarding primitives", () => {
    expect(typeof schemas.createEmptyPlaybook).toBe("function");
    expect(schemas.PlaybookSchema).toBeDefined();
    expect(schemas.BusinessFactsSchema).toBeDefined();
    expect(schemas.ScanResultSchema).toBeDefined();
    expect(schemas.DashboardOverviewSchema).toBeDefined();
  });
});

describe("OperatorOverview rename (PR-2)", () => {
  it("exports OperatorOverviewSchema", () => {
    expect(schemas.OperatorOverviewSchema).toBeDefined();
  });

  it("exports the back-compat alias DashboardOverviewSchema", () => {
    expect(schemas.DashboardOverviewSchema).toBeDefined();
  });

  it("alias and canonical schema are the same object", () => {
    expect(schemas.DashboardOverviewSchema).toBe(schemas.OperatorOverviewSchema);
  });
});
