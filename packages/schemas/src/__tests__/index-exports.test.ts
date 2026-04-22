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
