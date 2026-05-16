import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI guard: no operator-facing string in the cockpit surface may use the
 * legacy "tours pipeline" framing or the leaked tenant brand "HotPod".
 *
 * Scans BOTH production code and __tests__/ subdirs because synthetic test
 * fixtures that mirror production strings have leaked the brand name in the
 * past (see the 2026-05-16 cockpit-vertical-copy spec). The hygiene test
 * file itself is excluded by name — its inline `BANNED` array would
 * otherwise self-trip.
 *
 * If a future medspa operator does want "tour" wording back, change it
 * intentionally in `cockpit-vertical-copy-design.md`, narrow the BANNED
 * list, and update this test in the same PR.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN_ROOTS = [join(HERE, "..", "components", "cockpit"), join(HERE, "..", "lib", "cockpit")];

const BANNED: ReadonlyArray<{ phrase: string; caseInsensitive?: boolean }> = [
  // All entries are case-insensitive to match the api hygiene test's behavior
  // (both guards walk the same banned-phrase space; asymmetric case-sensitivity
  // would let "BOOK TOURS" slip past one but not the other).
  // The leading space on " in tour value" prevents false positives on the
  // internal variable name `tourValue` while still catching the user-visible
  // suffix string.
  { phrase: "HotPod", caseInsensitive: true },
  { phrase: "Tours pipeline", caseInsensitive: true },
  { phrase: "book tours", caseInsensitive: true },
  { phrase: " in tour value", caseInsensitive: true },
  { phrase: "tour calendar", caseInsensitive: true },
];

const SELF_BASENAME = "cockpit-copy-hygiene.test.ts";

interface Offense {
  file: string;
  line: number;
  phrase: string;
  context: string;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (st.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
  return files;
}

function scan(): Offense[] {
  const offenses: Offense[] = [];
  const files: string[] = [];
  for (const root of SCAN_ROOTS) files.push(...walk(root));

  for (const file of files) {
    if (file.endsWith(SELF_BASENAME)) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const { phrase, caseInsensitive } of BANNED) {
      const needle = caseInsensitive ? phrase.toLowerCase() : phrase;
      lines.forEach((line, idx) => {
        const haystack = caseInsensitive ? line.toLowerCase() : line;
        if (haystack.includes(needle)) {
          offenses.push({
            file: relative(join(HERE, ".."), file),
            line: idx + 1,
            phrase,
            context: line.trim(),
          });
        }
      });
    }
  }
  return offenses;
}

describe("cockpit copy hygiene", () => {
  it("no banned legacy or tenant-brand phrase appears in the cockpit surface", () => {
    const offenses = scan();
    if (offenses.length > 0) {
      const formatted = offenses
        .map((o) => `  ${o.file}:${o.line}  →  "${o.phrase}"\n      ${o.context}`)
        .join("\n");
      throw new Error(
        `Found ${offenses.length} banned phrase(s) in the cockpit surface. ` +
          `These strings must not reappear (see docs/superpowers/specs/2026-05-16-cockpit-vertical-copy-design.md). ` +
          `Offenders:\n${formatted}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});
