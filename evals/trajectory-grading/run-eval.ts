#!/usr/bin/env tsx
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTrajectoryCases } from "./load-fixtures.js";
import { gradeTrajectory } from "./grade.js";

/**
 * Trajectory-grading eval runner.
 *
 * Deterministic, model-free, DB-free: every golden case is graded through the real
 * `gradeTrajectory` and its actual verdict + violation kinds are compared to the case's declared
 * expectation. No ANTHROPIC_API_KEY and no Postgres — runnable anywhere, anytime.
 *
 * Usage: `pnpm eval:trajectory`
 * Exit 0 = every case grades to its declared verdict + kinds; exit 1 = at least one mismatch.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function main(): void {
  const cases = loadTrajectoryCases(FIXTURES_DIR);
  console.warn(`Loaded ${cases.length} trajectory cases from ${FIXTURES_DIR}`);

  const mismatches: string[] = [];
  for (const c of cases) {
    const result = gradeTrajectory({
      trustLevel: c.trustLevel,
      expected: c.expected,
      trajectory: c.trajectory,
    });
    const actualVerdict = result.ok ? "pass" : "fail";
    if (actualVerdict !== c.expectedVerdict) {
      const got = result.violations.map((v) => v.kind).join(", ") || "none";
      mismatches.push(
        `${c.id}: expected verdict ${c.expectedVerdict}, got ${actualVerdict} (violations: ${got})`,
      );
      continue;
    }
    if (c.expectedViolationKinds) {
      const actualKinds = uniqueSorted(result.violations.map((v) => v.kind));
      const expectedKinds = uniqueSorted(c.expectedViolationKinds);
      if (JSON.stringify(actualKinds) !== JSON.stringify(expectedKinds)) {
        mismatches.push(
          `${c.id}: expected violation kinds [${expectedKinds.join(", ")}], got [${actualKinds.join(", ")}]`,
        );
      }
    }
  }

  if (mismatches.length > 0) {
    console.error(`\n${mismatches.length} MISMATCH(es):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.warn(`\nAll ${cases.length} trajectory cases grade to their expected verdict + kinds.`);
}

main();
