import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Pins the slice-2 spec §3.7 invariant: `revenue_proven` DeploymentMemory rows are
 * written ONLY by the Riley-owned promotion module — Mira's creative-pipeline and the
 * conversation-memory service can never self-certify a creative as "revenue-proven".
 * Mirrors apps/api/src/__tests__/ingress-boundary.test.ts (source-scan enforcement).
 */
const ALLOWED = "revenue-proven-promotion.ts";

const ROOTS = [
  resolve(import.meta.dirname, "../services/cron"),
  resolve(import.meta.dirname, "../../../../packages/creative-pipeline/src"),
  resolve(import.meta.dirname, "../../../../packages/core/src/memory"),
];

// A write is `category: "revenue_proven"` (the create/upsert call shape). Reads
// (`r.category === "revenue_proven"` in builders/mira.ts) use a different syntax.
const WRITE_PATTERN = /category:\s*["']revenue_proven["']/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("revenue_proven writer boundary", () => {
  it("only revenue-proven-promotion.ts writes the revenue_proven category", () => {
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of tsFiles(root)) {
        scanned += 1;
        if (file.endsWith(ALLOWED)) continue;
        const src = readFileSync(file, "utf-8");
        expect(WRITE_PATTERN.test(src), `${file} must not write the revenue_proven category`).toBe(
          false,
        );
      }
    }
    // Guard the guard: confirm the scan actually walked real source trees.
    expect(scanned).toBeGreaterThan(10);
  });

  it("the allowed module does write the category (the test is not vacuous)", () => {
    const promotion = readFileSync(
      resolve(import.meta.dirname, "../services/cron", ALLOWED),
      "utf-8",
    );
    expect(WRITE_PATTERN.test(promotion)).toBe(true);
  });
});
