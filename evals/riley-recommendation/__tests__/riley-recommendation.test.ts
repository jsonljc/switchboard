import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRileyCases } from "../load-fixtures.js";
import { decideForCase } from "../decide.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cases = loadRileyCases(FIXTURES_DIR);

describe("riley recommendation matrix (real decideForCampaign)", () => {
  it("loads a non-empty case set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(1);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s resolves to its expected outcome", (_id, c) => {
    expect(decideForCase(c)).toBe(c.expectedOutcome);
  });
});
