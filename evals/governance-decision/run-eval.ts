#!/usr/bin/env tsx
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGovernanceCases } from "./load-fixtures.js";
import { decideForCase } from "./decide.js";

/**
 * Governance-decision eval runner.
 *
 * Deterministic, model-free, DB-free: every case is resolved through the REAL
 * live gate (`getToolGovernanceDecision`) and compared to its expected decision.
 * Needs NO ANTHROPIC_API_KEY and NO Postgres — runnable anywhere, anytime.
 *
 * Usage: `pnpm eval:governance`
 * Exit 0 = all cases match; exit 1 = at least one mismatch.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

function main(): void {
  const cases = loadGovernanceCases(FIXTURES_DIR);
  console.warn(`Loaded ${cases.length} governance cases from ${FIXTURES_DIR}`);

  const mismatches: string[] = [];
  for (const c of cases) {
    const actual = decideForCase({
      effectCategory: c.effectCategory,
      trustLevel: c.trustLevel,
      governanceOverride: c.governanceOverride,
    });
    const status = actual === c.expectedDecision ? "ok" : "MISMATCH";
    if (status === "MISMATCH") {
      mismatches.push(
        `${c.id}: expected ${c.expectedDecision}, got ${actual} ` +
          `(${c.effectCategory} @ ${c.trustLevel}${c.governanceOverride ? " +override" : ""})`,
      );
    }
  }

  if (mismatches.length > 0) {
    console.error(`\n${mismatches.length} MISMATCH(es):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.warn(`\nAll ${cases.length} governance decisions match the live gate.`);
}

main();
