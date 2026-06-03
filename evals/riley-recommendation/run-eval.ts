#!/usr/bin/env tsx
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRileyCases } from "./load-fixtures.js";
import { decideForCase } from "./decide.js";
import {
  loadSourceReallocationCases,
  decideSourceReallocationForCase,
} from "./source-reallocation-eval.js";

/**
 * Riley-recommendation eval runner.
 *
 * Deterministic, model-free, DB-free: every case is resolved through the REAL
 * `decideForCampaign` pipeline and compared to its expected reduced outcome.
 * Needs NO ANTHROPIC_API_KEY and NO Postgres — runnable anywhere, anytime.
 *
 * Usage: `pnpm eval:riley`
 * Exit 0 = all cases match; exit 1 = at least one mismatch.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const SR_FIXTURES_DIR = join(FIXTURES_DIR, "source-reallocation");

async function main(): Promise<void> {
  const cases = loadRileyCases(FIXTURES_DIR);
  console.warn(`Loaded ${cases.length} Riley recommendation cases from ${FIXTURES_DIR}`);

  const mismatches: string[] = [];
  for (const c of cases) {
    const decision = decideForCase(c);
    const ctx = `(${c.economicTier} tier @ ${c.learningState}, ${c.targetBreach.periodsAboveTarget} over target)`;
    if (decision.primary !== c.expectedOutcome) {
      mismatches.push(`${c.id}: expected ${c.expectedOutcome}, got ${decision.primary} ${ctx}`);
    }
    for (const action of c.expectedActions ?? []) {
      if (!decision.actions.includes(action)) {
        mismatches.push(
          `${c.id}: expected action "${action}" among [${decision.actions.join(", ")}] ${ctx}`,
        );
      }
    }
    for (const pattern of c.expectedWatchPatterns ?? []) {
      if (!decision.watchPatterns.includes(pattern)) {
        mismatches.push(
          `${c.id}: expected watch pattern "${pattern}" among [${decision.watchPatterns.join(", ")}] ${ctx}`,
        );
      }
    }
    if (c.expectedTargetSource && decision.targetSource !== c.expectedTargetSource) {
      mismatches.push(
        `${c.id}: expected targetSource ${c.expectedTargetSource}, got ${decision.targetSource ?? "undefined"} ${ctx}`,
      );
    }
  }

  const srCases = loadSourceReallocationCases(SR_FIXTURES_DIR);
  console.warn(`Loaded ${srCases.length} source-reallocation cases from ${SR_FIXTURES_DIR}`);
  for (const c of srCases) {
    const decision = await decideSourceReallocationForCase(c);
    if (decision.outcome !== c.expectedOutcome) {
      mismatches.push(`${c.id}: expected ${c.expectedOutcome}, got ${decision.outcome}`);
    }
    if (c.expectedWatchPattern && decision.watchPattern !== c.expectedWatchPattern) {
      mismatches.push(
        `${c.id}: expected watch ${c.expectedWatchPattern}, got ${decision.watchPattern ?? "none"}`,
      );
    }
  }

  if (mismatches.length > 0) {
    console.error(`\n${mismatches.length} MISMATCH(es):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.warn(
    `\nAll ${cases.length} decideForCampaign + ${srCases.length} source-reallocation cases match.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
