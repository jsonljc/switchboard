#!/usr/bin/env tsx
/**
 * Fails if any dashboard source file uses a raw Tailwind amber/yellow utility
 * class (e.g. bg-amber-100, text-yellow-600, border-amber-200, hover:bg-yellow-400).
 * The authed app expresses caution/warning tones through the semantic tokens
 * (caution / agent-attention / positive), not raw palette amber, which reads as
 * pasted-in AI-default chrome (audit M2). This is the CI-enforced backstop to the
 * eslint no-restricted-syntax rule, because the dashboard's own `lint` script is
 * stubbed and `turbo lint` never lints it (mirrors check-no-dynamic-public-env.ts).
 *
 * Excludes test files, the dev-only DevPanel chrome (components/dev), and the
 * landing/v6 marketing register, which keep their own palettes.
 *
 * Runs in CI via `pnpm local:verify:fast` (the lint job).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface RawStatusColorHit {
  file: string;
  line: number;
  text: string;
}

const DASHBOARD_SRC = "apps/dashboard/src";
// Matches a raw Tailwind amber/yellow color class: any utility prefix
// (bg-, text-, border-, ring-, from-, etc., with an optional variant like
// hover:) ending in `-amber-<shade>` or `-yellow-<shade>`. Semantic tokens
// (caution, positive, agent-attention) never contain `-amber-N`/`-yellow-N`,
// so this only catches raw palette use, not the tokens that replace it.
const RAW_AMBER_YELLOW_RE = /-(?:amber|yellow)-\d/;

/** Blank out // line comments and block comments, preserving newlines. */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.replace(/\/\/[^\n]*/g, "");
}

/** 1-based line numbers in `source` that use a raw amber/yellow Tailwind class. */
export function findRawStatusColorLines(source: string): number[] {
  const lines = stripComments(source).split("\n");
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (RAW_AMBER_YELLOW_RE.test(line)) out.push(i + 1);
  });
  return out;
}

// Registers that keep their own palettes and are intentionally exempt.
const EXCLUDED_DIR_SEGMENTS = ["/components/dev/", "/components/landing/"];

function isExcludedPath(path: string): boolean {
  if (path.includes("/__tests__/") || path.endsWith(".test.ts") || path.endsWith(".test.tsx")) {
    return true;
  }
  return EXCLUDED_DIR_SEGMENTS.some((seg) => path.includes(seg));
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if ((full.endsWith(".ts") || full.endsWith(".tsx")) && !isExcludedPath(full)) {
      out.push(full);
    }
  }
  return out;
}

export function auditDashboardStatusColors(opts: { repoRoot: string }): RawStatusColorHit[] {
  const root = join(opts.repoRoot, DASHBOARD_SRC);
  const hits: RawStatusColorHit[] = [];
  for (const file of listSourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const line of findRawStatusColorLines(source)) {
      hits.push({
        file: relative(opts.repoRoot, file),
        line,
        text: (lines[line - 1] ?? "").trim(),
      });
    }
  }
  return hits;
}

/* eslint-disable no-console */
function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const hits = auditDashboardStatusColors({ repoRoot });
  if (hits.length) {
    console.log("✗ raw Tailwind amber/yellow class(es) in dashboard src (use semantic tokens):");
    for (const h of hits) console.log(`    ${h.file}:${h.line}  ${h.text}`);
    console.log(
      "  Use the caution / agent-attention / positive tokens (e.g. bg-caution, text-caution, bg-caution-subtle), not raw amber/yellow (audit M2).",
    );
    process.exit(1);
  }
  console.log("✓ no raw amber/yellow status classes in dashboard src");
  process.exit(0);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
