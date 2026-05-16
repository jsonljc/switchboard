#!/usr/bin/env tsx
/**
 * Fast structural pre-flight.
 *
 * Runs:
 *   1. env-completeness         (scripts/check-env-completeness.ts)
 *   2. live-flag manifest       (scripts/check-live-flag-manifest.ts)
 *   3. arch:check               (pnpm arch:check)
 *   4. route-ingress check      (.agent/tools/check-routes)
 *   5. seed-count check         (scripts/check-seed-counts.ts — fails if no DB; --strict-db locally)
 *   6. dashboard typecheck      (pnpm --filter @switchboard/dashboard typecheck)
 *
 * Acceptance gate (per phase-2 spec PR B): total wall-clock ≤30s warm-cache,
 * ≤60s cold. Locally requires DATABASE_URL + reachable Postgres for step 5;
 * step 6 requires `packages/{schemas,db,core}/dist` to exist (run `pnpm build`
 * once via `pnpm local:setup`, or rely on CI's restored dist cache).
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
    // --strict-db is local-only: CI's lint job runs this before the setup job
    // provisions Postgres, so requiring DB here would fail the lint stage.
    // CI's setup job invokes check-seed-counts.ts directly after DB is up.
    name: "seed-counts",
    cmd: "pnpm",
    args: [
      "exec",
      "tsx",
      "scripts/check-seed-counts.ts",
      ...(process.env["CI"] ? [] : ["--strict-db"]),
    ],
  },
  // Last so cheaper structural checks fail fast before we pay the typecheck
  // cost. CI's lint job restores packages/*/dist from the setup-job cache,
  // satisfying the @switchboard/core import resolution this step requires.
  {
    name: "dashboard:typecheck",
    cmd: "pnpm",
    args: ["--filter", "@switchboard/dashboard", "typecheck"],
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
