import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOVERNANCE_POLICY } from "@switchboard/core/skill-runtime";
import { loadGovernanceCases } from "../load-fixtures.js";
import { decideForCase } from "../decide.js";
import { EffectCategoryEnum, TrustLevelEnum } from "../schema.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cases = loadGovernanceCases(FIXTURES_DIR);

describe("governance-decision matrix (live gate)", () => {
  it("loads a non-empty case set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(26);
  });

  it.each(cases.map((c) => [c.id, c] as const))(
    "%s resolves to its expected decision via the live gate",
    (_id, c) => {
      const actual = decideForCase({
        effectCategory: c.effectCategory,
        trustLevel: c.trustLevel,
        governanceOverride: c.governanceOverride,
      });
      expect(actual).toBe(c.expectedDecision);
    },
  );
});

describe("policy-table drift guard", () => {
  it("the eval's effect-category enum matches the live GOVERNANCE_POLICY keys", () => {
    const policyCategories = Object.keys(GOVERNANCE_POLICY).sort();
    expect([...EffectCategoryEnum.options].sort()).toEqual(policyCategories);
  });

  it("the eval's trust-level enum matches the live policy's per-category keys", () => {
    const firstCategory = Object.keys(GOVERNANCE_POLICY)[0]!;
    const policyTrustLevels = Object.keys(
      GOVERNANCE_POLICY[firstCategory as keyof typeof GOVERNANCE_POLICY],
    ).sort();
    expect([...TrustLevelEnum.options].sort()).toEqual(policyTrustLevels);
  });

  it("the no-override grid covers every (effectCategory × trustLevel) combination", () => {
    const gridKeys = new Set(
      cases.filter((c) => !c.governanceOverride).map((c) => `${c.effectCategory}::${c.trustLevel}`),
    );
    for (const category of EffectCategoryEnum.options) {
      for (const trust of TrustLevelEnum.options) {
        expect(gridKeys.has(`${category}::${trust}`)).toBe(true);
      }
    }
  });
});
