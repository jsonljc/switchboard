#!/usr/bin/env tsx
/**
 * One-shot local bootstrap: install → setup-env → build → migrate → seed
 * → verify:fast. Safe to re-run (idempotent).
 *
 * When Postgres is not reachable, runs the non-DB steps (install,
 * setup-env, build), prints recovery guidance, and exits non-zero
 * BEFORE local:verify:fast. We cannot run verify in that state because
 * local:verify:fast passes `--strict-db`, which would fail with a
 * generic strict-db banner — the explicit recovery message here is
 * clearer. "Setup is incomplete" is the correct signal; the "no silent
 * green" promise demands a non-zero exit.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Step {
  name: string;
  cmd: string;
  args: string[];
  dbRequired?: boolean;
}

export const STEPS: Step[] = [
  { name: "install", cmd: "pnpm", args: ["install"] },
  { name: "setup-env", cmd: "bash", args: ["scripts/setup-env.sh"] },
  { name: "build", cmd: "pnpm", args: ["build"] },
  { name: "db:migrate", cmd: "pnpm", args: ["db:migrate"], dbRequired: true },
  { name: "db:seed", cmd: "pnpm", args: ["db:seed"], dbRequired: true },
  { name: "local:verify:fast", cmd: "pnpm", args: ["local:verify:fast"] },
];

/* eslint-disable no-console */
function isDbReachable(): boolean {
  try {
    // Parse DATABASE_URL out of .env (avoid `source` — shell chokes on & in URLs).
    const envText = readFileSync(resolve(REPO_ROOT, ".env"), "utf8");
    const match = envText.match(/^DATABASE_URL=(.+)$/m);
    if (!match) return false;
    const dbUrl = match[1].replace(/^['"]|['"]$/g, "");
    const result = spawnSync("pg_isready", ["-d", dbUrl], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function runStep(s: Step): boolean {
  process.stdout.write(`\n→ ${s.name}...\n`);
  const result = spawnSync(s.cmd, s.args, { cwd: REPO_ROOT, stdio: "inherit" });
  return (result.status ?? 1) === 0;
}

function main(): void {
  // Check DB reachability lazily — on first hit of a dbRequired step.
  // This way setup-env has already created `.env` (with DATABASE_URL),
  // so a fresh-clone-with-Postgres-running scenario detects correctly
  // instead of always seeing "DB not reachable" on first invocation.
  let dbReachable: boolean | null = null;

  for (const step of STEPS) {
    if (dbReachable === null && step.dbRequired) {
      dbReachable = isDbReachable();
      if (!dbReachable) {
        console.log(
          "[local:setup] DB not reachable — db:migrate, db:seed, and local:verify:fast will be skipped.",
        );
      }
    }
    // When DB is missing, skip DB-required steps AND verify:fast (verify
    // uses --strict-db; it would fail with a generic banner. We surface a
    // clearer message at the end and exit non-zero.)
    if (dbReachable === false && (step.dbRequired || step.name === "local:verify:fast")) {
      console.log(`→ ${step.name}... SKIPPED (no DB)`);
      continue;
    }
    if (!runStep(step)) {
      console.error(`✗ ${step.name} failed.`);
      process.exit(1);
    }
  }

  if (dbReachable === false) {
    console.error("\n✗ DB not reachable. Local setup is incomplete.");
    console.error("  Start Postgres and re-run `pnpm local:setup`.");
    process.exit(1);
  }

  console.log("\n✓ Local setup complete.");
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
