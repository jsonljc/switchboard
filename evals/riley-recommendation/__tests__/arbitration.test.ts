import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArbitrationCases, runArbitrationCase } from "../arbitration-eval.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "arbitration");
const cases = loadArbitrationCases(FIXTURES_DIR);

describe("riley arbitration matrix (real decideForCampaign -> real arbitrate)", () => {
  it("loads a non-empty case set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(1);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s selects its expected primary", (_id, c) => {
    const decision = runArbitrationCase(c);
    expect(decision.primary).toEqual(c.expectedPrimary);
    for (const action of c.expectedSecondaryActions ?? []) {
      expect(decision.secondaryActions).toContain(action);
    }
    if (c.expectedMeasurementFixAction !== undefined) {
      expect(decision.measurementFixAction).toBe(c.expectedMeasurementFixAction);
    }
  });
});
