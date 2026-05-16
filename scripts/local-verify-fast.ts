#!/usr/bin/env tsx
/**
 * Fast structural pre-flight (≤10s, no Postgres required).
 *
 * Runs:
 *   1. env-completeness         (scripts/check-env-completeness.ts)
 *   2. live-flag manifest       (scripts/check-live-flag-manifest.ts)
 *   3. arch:check               (pnpm arch:check)
 *   4. route-ingress check      (.agent/tools/check-routes)
 *   5. seed-count check         (scripts/check-seed-counts.ts — fails if no DB; --strict-db)
 *
 * Fail-fast: stops at first non-zero exit. Each step prints a one-line
 * summary.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  name: string;
  cmd: string;
  args: string[];
}

const STEPS: Step[] = [
  {
    name: "env-completeness",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-env-completeness.ts"],
  },
  {
    name: "live-flag-manifest",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-live-flag-manifest.ts"],
  },
  { name: "arch:check", cmd: "pnpm", args: ["arch:check"] },
  { name: "route-ingress", cmd: "bash", args: [".agent/tools/check-routes"] },
  {
    name: "seed-counts",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-seed-counts.ts", "--strict-db"],
  },
];

/* eslint-disable no-console */
function runStep(s: Step): boolean {
  process.stdout.write(`→ ${s.name}... `);
  const result = spawnSync(s.cmd, s.args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const code = result.status ?? 1;
  if (code === 0) {
    process.stdout.write("OK\n");
    return true;
  }
  process.stdout.write(`FAIL (exit ${code})\n`);
  if (result.stdout?.length) process.stdout.write(result.stdout.toString());
  if (result.stderr?.length) process.stderr.write(result.stderr.toString());
  return false;
}

function main(): void {
  console.log("local:verify:fast — structural pre-flight\n");
  for (const step of STEPS) {
    if (!runStep(step)) {
      console.error("\n✗ local:verify:fast failed at:", step.name);
      process.exit(1);
    }
  }
  console.log("\n✓ local:verify:fast — all checks passed");
  process.exit(0);
}
/* eslint-enable no-console */

main();
