#!/usr/bin/env tsx
/**
 * Fails if any dashboard source file reads process.env with a dynamic/computed
 * key (process.env[...]). Next.js only inlines NEXT_PUBLIC_* into the client
 * bundle via static literal access (process.env.NEXT_PUBLIC_X); a bracket read
 * is permanently undefined in the browser (the F9 / F-20 bug). This is the
 * CI-enforced backstop to the eslint no-restricted-syntax rule, because the
 * dashboard's own `lint` script is stubbed and `turbo lint` never lints it.
 *
 * Runs in CI via `pnpm local:verify:fast` (the lint job).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface DynamicEnvRead {
  file: string;
  line: number;
  text: string;
}

const DASHBOARD_SRC = "apps/dashboard/src";
// Matches computed process.env reads — process.env[...] and the optional-chained
// forms process?.env[...] / process.env?.[...] / process?.env?.[...] — but NOT
// static dot access (process.env.FOO, the only form Next inlines client-side).
// \b avoids matching inside an identifier like `myProcess`.
const DYNAMIC_ENV_RE = /\bprocess\??\.env(?:\?\.)?\s*\[/;

/** Blank out // line comments and block comments, preserving newlines. */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.replace(/\/\/[^\n]*/g, "");
}

/** 1-based line numbers in `source` containing a computed process.env[...] read. */
export function findDynamicEnvReadLines(source: string): number[] {
  const lines = stripComments(source).split("\n");
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (DYNAMIC_ENV_RE.test(line)) out.push(i + 1);
  });
  return out;
}

function isTestPath(path: string): boolean {
  return path.includes("/__tests__/") || path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if ((full.endsWith(".ts") || full.endsWith(".tsx")) && !isTestPath(full)) {
      out.push(full);
    }
  }
  return out;
}

export function auditDashboardEnvReads(opts: { repoRoot: string }): DynamicEnvRead[] {
  const root = join(opts.repoRoot, DASHBOARD_SRC);
  const hits: DynamicEnvRead[] = [];
  for (const file of listSourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const line of findDynamicEnvReadLines(source)) {
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
  const hits = auditDashboardEnvReads({ repoRoot });
  if (hits.length) {
    console.log("✗ dynamic process.env[...] read(s) in dashboard src (not inlined by Next):");
    for (const h of hits) console.log(`    ${h.file}:${h.line}  ${h.text}`);
    console.log("  Use a static switch over literal process.env.NEXT_PUBLIC_* reads (F9).");
    process.exit(1);
  }
  console.log("✓ no dynamic process.env[...] reads in dashboard src");
  process.exit(0);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
