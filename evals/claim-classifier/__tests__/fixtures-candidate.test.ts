import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures } from "../load-fixtures.js";
import { FixtureRowSchema, ClaimTypeEnum } from "../schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIR = join(HERE, "..", "fixtures-candidate");
const LIVE_DIR = join(HERE, "..", "fixtures");

const candidates = loadFixtures(CANDIDATE_DIR);

describe("claim-classifier candidate boundary variants (structural)", () => {
  it("loads a meaningful number of candidate variants", () => {
    expect(candidates.length).toBeGreaterThanOrEqual(15);
  });

  it("every candidate row parses FixtureRowSchema", () => {
    for (const row of candidates) {
      expect(FixtureRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it("candidate ids are unique", () => {
    const ids = candidates.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("expectedClaimType and acceptableClaimTypes are valid claim labels", () => {
    const valid = new Set<string>(ClaimTypeEnum.options);
    for (const row of candidates) {
      expect(valid.has(row.expectedClaimType)).toBe(true);
      for (const t of row.acceptableClaimTypes ?? []) {
        expect(valid.has(t)).toBe(true);
      }
    }
  });

  it("covers negation, adversarial-false-positive, ambiguous, and code-switch categories", () => {
    const ids = candidates.map((r) => r.id);
    expect(ids.some((id) => id.startsWith("bnd-neg-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("bnd-fp-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("bnd-amb-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("bnd-cs-"))).toBe(true);
    // Code-switch rows must use a non-English language.
    const csRows = candidates.filter((r) => r.id.startsWith("bnd-cs-"));
    for (const r of csRows) expect(r.language === "zh" || r.language === "ms").toBe(true);
  });

  it("the live loader does NOT pick up the candidate dir (gate stays green pre-promotion)", () => {
    const liveIds = new Set(loadFixtures(LIVE_DIR).map((r) => r.id));
    for (const c of candidates) {
      expect(liveIds.has(c.id)).toBe(false);
    }
  });
});
