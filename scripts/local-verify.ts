#!/usr/bin/env tsx
/**
 * Full pre-flight: calls local:verify:fast first, then the heavy checks
 * (typecheck, lint, test, dashboard build, seed integrity).
 *
 * Fail-fast: stops at first non-zero exit.
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

const HEAVY_STEPS: Step[] = [
  { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
  { name: "lint", cmd: "pnpm", args: ["lint"] },
  { name: "test", cmd: "pnpm", args: ["test"] },
  { name: "dashboard build", cmd: "pnpm", args: ["--filter", "@switchboard/dashboard", "build"] },
];

/* eslint-disable no-console */
function run(s: Step, label: string): boolean {
  console.log(`\n→ ${label}: ${s.name}`);
  const result = spawnSync(s.cmd, s.args, { cwd: REPO_ROOT, stdio: "inherit" });
  return (result.status ?? 1) === 0;
}

function main(): void {
  console.log("local:verify — full pre-flight\n");

  if (!run({ name: "local:verify:fast", cmd: "pnpm", args: ["local:verify:fast"] }, "fast")) {
    console.error("\n✗ local:verify failed at fast pre-flight");
    process.exit(1);
  }

  for (const step of HEAVY_STEPS) {
    if (!run(step, "heavy")) {
      console.error(`\n✗ local:verify failed at: ${step.name}`);
      process.exit(1);
    }
  }

  console.log("\n✓ local:verify — all checks passed");
  process.exit(0);
}
/* eslint-enable no-console */

main();
