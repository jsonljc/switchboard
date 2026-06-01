import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGovernanceCases } from "../load-fixtures.js";
import { GovernanceCaseSchema } from "../schema.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("governance-decision fixtures (structural)", () => {
  const cases = loadGovernanceCases(FIXTURES_DIR);

  it("every fixture parses GovernanceCaseSchema", () => {
    for (const c of cases) {
      expect(GovernanceCaseSchema.safeParse(c).success).toBe(true);
    }
  });

  it("fixture ids are unique", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("override cases declare a governanceOverride; grid cases do not", () => {
    const overrideCases = cases.filter((c) => c.id.startsWith("override-"));
    const gridCases = cases.filter((c) => c.id.startsWith("grid-"));
    expect(overrideCases.length).toBeGreaterThanOrEqual(5);
    expect(gridCases.length).toBe(21);
    for (const c of overrideCases) expect(c.governanceOverride).toBeDefined();
    for (const c of gridCases) expect(c.governanceOverride).toBeUndefined();
  });

  it("rejects an unknown effect category", () => {
    const parsed = GovernanceCaseSchema.safeParse({
      id: "bad",
      effectCategory: "teleport",
      trustLevel: "guided",
      expectedDecision: "deny",
    });
    expect(parsed.success).toBe(false);
  });
});
