import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const V6_DIR = join(__dirname, "..");
const PUBLIC_DIR = join(__dirname, "../../../..", "app", "(public)");

const sourceFiles = (): string[] => {
  const v6 = readdirSync(V6_DIR)
    .filter(
      (f) =>
        (f.endsWith(".tsx") || f.endsWith(".ts") || f.endsWith(".css")) && !f.includes(".test."),
    )
    .map((f) => join(V6_DIR, f));
  return [...v6, join(PUBLIC_DIR, "page.tsx"), join(PUBLIC_DIR, "layout.tsx")];
};

// Word-boundary regex so "innovate"/"renovation" don't false-positive.
const STALE_NAMES = [
  { pattern: /\bnova\b/i, name: "Nova", canonical: "Riley" },
  {
    pattern: /\bjordan\b/i,
    name: "Jordan",
    canonical: "(removed — Jordan was a stale agent name; use Alex/Riley/Mira)",
  },
];

describe("v6 landing — no stale agent names", () => {
  const files = sourceFiles();

  it("source file inventory is non-empty (smoke test)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const stale of STALE_NAMES) {
    it(`pattern ${stale.pattern} is absent (was: ${stale.name}, canonical: ${stale.canonical})`, () => {
      const offenders: string[] = [];
      for (const path of files) {
        const content = readFileSync(path, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (stale.pattern.test(line)) {
            offenders.push(`${path}:${idx + 1} → ${line.trim()}`);
          }
        });
      }
      if (offenders.length > 0) {
        const message = `Stale agent name "${stale.name}" found in marketing surfaces:\n${offenders.join("\n")}\nCanonical replacement: ${stale.canonical}`;
        throw new Error(message);
      }
    });
  }
});
