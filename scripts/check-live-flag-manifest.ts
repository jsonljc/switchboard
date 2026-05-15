#!/usr/bin/env tsx
/**
 * Asserts that .env.example's NEXT_PUBLIC_*_LIVE defaults match
 * scripts/env-allowlist.live-flag-matrix.json. Prevents silent drift.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Matrix {
  flags: Record<string, { default: string; rationale: string }>;
}

export interface FlagDrift {
  name: string;
  expected: string;
  actual: string;
}

export interface ManifestResult {
  drift: FlagDrift[];
  missing: string[];
}

function readEnvExampleFlags(repoRoot: string): Map<string, string> {
  const text = readFileSync(join(repoRoot, ".env.example"), "utf8");
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^(NEXT_PUBLIC_[A-Z_]*_LIVE)=(.*)$/.exec(line);
    if (m) {
      const [, name, value] = m;
      out.set(name!, value!.trim());
    }
  }
  return out;
}

export function compareLiveFlagDefaults(opts: {
  matrix: Matrix;
  actual: Map<string, string>;
}): ManifestResult {
  const drift: FlagDrift[] = [];
  const missing: string[] = [];

  for (const [name, { default: expected }] of Object.entries(opts.matrix.flags)) {
    const actualValue = opts.actual.get(name);
    if (actualValue === undefined) {
      missing.push(name);
    } else if (actualValue !== expected) {
      drift.push({ name, expected, actual: actualValue });
    }
  }

  return { drift, missing };
}

export function auditLiveFlagManifest(opts: { repoRoot: string }): ManifestResult {
  const matrix: Matrix = JSON.parse(
    readFileSync(join(opts.repoRoot, "scripts/env-allowlist.live-flag-matrix.json"), "utf8"),
  );
  const actual = readEnvExampleFlags(opts.repoRoot);
  return compareLiveFlagDefaults({ matrix, actual });
}

/* eslint-disable no-console */
function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = auditLiveFlagManifest({ repoRoot });
  let fail = false;
  if (result.missing.length) {
    fail = true;
    console.log(`✗ Flags missing from .env.example: ${result.missing.join(", ")}`);
  }
  if (result.drift.length) {
    fail = true;
    console.log("✗ Flag defaults drifted:");
    for (const d of result.drift) {
      console.log(`    ${d.name}: expected ${d.expected}, actual ${d.actual}`);
    }
  }
  if (!fail) console.log("✓ live-flag manifest in sync");
  process.exit(fail ? 1 : 0);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
