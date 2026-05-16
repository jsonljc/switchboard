import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures } from "../load-fixtures.js";
import { ClaimTypeEnum } from "../schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

describe("fixtures directory", () => {
  const fixtures = loadFixtures(FIXTURES_DIR);

  it("contains at least 95 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(95);
  });

  it("has at least 3 examples per claim type", () => {
    const counts: Record<string, number> = {};
    for (const f of fixtures) counts[f.expectedClaimType] = (counts[f.expectedClaimType] ?? 0) + 1;
    for (const type of ClaimTypeEnum.options) {
      expect(counts[type] ?? 0, `claim type ${type} has too few examples`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("has unique ids", () => {
    const ids = new Set<string>();
    for (const f of fixtures) {
      expect(ids.has(f.id), `duplicate id: ${f.id}`).toBe(false);
      ids.add(f.id);
    }
  });

  it("has both SG and MY representation", () => {
    const sg = fixtures.filter((f) => f.jurisdiction === "SG").length;
    const my = fixtures.filter((f) => f.jurisdiction === "MY").length;
    expect(sg).toBeGreaterThanOrEqual(30);
    expect(my).toBeGreaterThanOrEqual(30);
  });
});
