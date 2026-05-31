import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Repo root from apps/dashboard/src/components/cockpit/__tests__/.
// Depth: __tests__ -> cockpit -> components -> src -> dashboard -> apps -> repo-root = 6 levels.
const ROOT = resolve(__dirname, "../../../../../../");
const SEEDS = [
  resolve(ROOT, "packages/db/src/seed/seed-mira-demo-creatives.ts"),
  resolve(ROOT, "packages/db/src/seed/seed-mira-pilot-orgs.ts"),
];

const FORBIDDEN_STATES = /\b(sent_to_riley|in_use|winner|fatigued|published)\b/;
// "learning" excluded from the WORD list here only where it is a banned UI word;
// in seeds we ban the capability words + the forbidden states.
const BANNED_WORDS = /\b(distribute|performance|fatigued|improved|drove|recovered)\b/i;

describe("Mira seeds — Phase-2 fixture ban", () => {
  for (const file of SEEDS) {
    it(`${file.split("/").pop()} contains no forbidden states`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(FORBIDDEN_STATES);
    });
    it(`${file.split("/").pop()} contains no banned capability words`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(BANNED_WORDS);
    });
  }
});
