import { describe, expect, it } from "vitest";
import * as schemas from "../index.js";

describe("schemas index exports", () => {
  it("exports dashboard onboarding primitives", () => {
    expect(typeof schemas.createEmptyPlaybook).toBe("function");
    expect(schemas.PlaybookSchema).toBeDefined();
    expect(schemas.BusinessFactsSchema).toBeDefined();
    expect(schemas.ScanResultSchema).toBeDefined();
    expect(schemas.OperatorOverviewSchema).toBeDefined();
  });

  it("exports operational-state primitives (riley v3 slice 4a)", () => {
    expect(schemas.OperationalStateSchema).toBeDefined();
    expect(schemas.OperationalStateConfirmationSchema).toBeDefined();
    expect(schemas.OperationalIntervalSchema).toBeDefined();
  });

  it("exports the operational-state staleness policy (riley v3 slice 4c)", () => {
    expect(schemas.OPERATIONAL_STATE_VOUCH_DAYS).toBe(14);
    expect(schemas.OPERATIONAL_STATE_VOUCH_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
