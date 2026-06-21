#!/usr/bin/env tsx
/**
 * Fast structural pre-flight (≤30s warm-cache, ≤60s cold).
 *
 * Runs:
 *   1. env-completeness         (scripts/check-env-completeness.ts)
 *   2. live-flag manifest       (scripts/check-live-flag-manifest.ts)
 *   3. no-dynamic-public-env    (scripts/check-no-dynamic-public-env.ts)
 *   4. no-raw-status-colors     (scripts/check-no-raw-status-colors.ts)
 *   5. arch:check               (pnpm arch:check)
 *   6. route-ingress check      (.agent/tools/check-routes)
 *   7. seed-count check         (scripts/check-seed-counts.ts, fails if no DB; --strict-db locally)
 *   8. dashboard typecheck      (local-only; CI's typecheck job already covers it)
 *
 * Locally requires DATABASE_URL + reachable Postgres for step 6; step 7
 * requires `packages/{schemas,db,core}/dist` to exist (run `pnpm build` once
 * via `pnpm local:setup`).
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
  {
    name: "no-dynamic-public-env",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-no-dynamic-public-env.ts"],
  },
  {
    name: "no-raw-status-colors",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-no-raw-status-colors.ts"],
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
  // Dashboard typecheck is local-only: CI's separate `typecheck` job already
  // runs `pnpm typecheck` (turbo), which covers @switchboard/dashboard. Running
  // it again here just doubles CI wall-clock with no extra signal. The
  // local benefit is catching dashboard typing regressions before push, when
  // a developer typically wouldn't run the heavier `pnpm typecheck`.
  // Placed last so cheaper structural checks fail fast before paying its cost.
  ...(process.env["CI"]
    ? []
    : [
        {
          name: "dashboard:typecheck",
          cmd: "pnpm",
          args: ["--filter", "@switchboard/dashboard", "typecheck"],
        } satisfies Step,
      ]),
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
