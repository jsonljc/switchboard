#!/usr/bin/env tsx
/**
 * Audits env-var coverage:
 *   1. Greps `process.env.FOO` and `process.env["FOO"]` from app source.
 *   2. Loads scripts/env-allowlist.local-readiness.json.
 *   3. Reads `.env.example` keys.
 *   4. Reports: uncategorized vars, required-but-missing-from-example,
 *      production_managed keys that leaked into .env.example, and
 *      deprecated warnings.
 *
 * Exits 1 if any required category has issues (uncategorized,
 * missingFromExample, leakedProductionManaged). Deprecated entries warn
 * but do not fail.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Allowlist {
  required_in_env_example: string[];
  ci_only: string[];
  test_only: string[];
  production_managed: string[];
  deprecated_allowed_temporarily: Array<string | { name: string; removeBy: string }>;
}

export interface AuditResult {
  uncategorized: string[];
  missingFromExample: string[];
  leakedProductionManaged: string[];
  deprecatedWarnings: string[];
}

const APP_DIRS = ["apps/api/src", "apps/chat/src", "apps/dashboard/src", "apps/mcp-server/src"];

// Direct, statically-resolvable references: `process.env.FOO` and `process.env["FOO"]`.
const ENV_KEY_RE = /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]/g;

// Detect files that read env via a non-literal expression — e.g.
// `process.env[name]`, `process.env[k]`, `process.env[TOOLS_LIVE_ENV[id]]`. These
// indirections defeat ENV_KEY_RE, so for files that contain at least one such
// dynamic lookup we additionally collect every UPPERCASE_SNAKE_CASE string
// literal in the file (parseEnvInt-style helper args, REQUIRED_ENV arrays,
// const-map values, etc.). Keeps false positives near zero because the only
// files that opt in are the handful that do dynamic env resolution.
const DYNAMIC_ENV_LOOKUP_RE = /process\.env\[\s*[^"'\]\s]/;
const UPPER_SNAKE_LITERAL_RE = /["']([A-Z][A-Z0-9_]{3,})["']/g;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function readEnvKeysFromCode(repoRoot: string): Set<string> {
  const keys = new Set<string>();
  for (const dir of APP_DIRS) {
    const root = join(repoRoot, dir);
    let files: string[];
    try {
      // Only swallow the "directory missing" case — partial repos / monorepos
      // in flight. Errors raised inside walkTs (e.g. unreadable files) must
      // propagate so they don't silently mask real failures.
      statSync(root);
      files = walkTs(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(ENV_KEY_RE)) {
        const k = m[1] ?? m[2];
        if (k) keys.add(k);
      }
      if (DYNAMIC_ENV_LOOKUP_RE.test(text)) {
        for (const m of text.matchAll(UPPER_SNAKE_LITERAL_RE)) {
          const k = m[1];
          if (k) keys.add(k);
        }
      }
    }
  }
  return keys;
}

function readEnvExampleKeys(repoRoot: string): Set<string> {
  const text = readFileSync(join(repoRoot, ".env.example"), "utf8");
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (m) keys.add(m[1]!);
  }
  return keys;
}

function readAllowlist(repoRoot: string): Allowlist {
  const path = join(repoRoot, "scripts/env-allowlist.local-readiness.json");
  return JSON.parse(readFileSync(path, "utf8")) as Allowlist;
}

function deprecatedName(entry: string | { name: string }): string {
  return typeof entry === "string" ? entry : entry.name;
}

/**
 * Pure auditor. Accepts already-parsed inputs so unit tests can exercise the
 * classification logic without filesystem fixtures.
 */
export function computeAuditResult(input: {
  codeKeys: Iterable<string>;
  exampleKeys: Iterable<string>;
  allowlist: Allowlist;
}): AuditResult {
  const codeKeys = new Set(input.codeKeys);
  const exampleKeys = new Set(input.exampleKeys);
  const allow = input.allowlist;
  const deprecated = new Set(allow.deprecated_allowed_temporarily.map(deprecatedName));

  const categorized = new Set<string>([
    ...allow.required_in_env_example,
    ...allow.ci_only,
    ...allow.test_only,
    ...allow.production_managed,
    ...deprecated,
  ]);

  const uncategorized = [...codeKeys].filter((k) => !categorized.has(k)).sort();
  const missingFromExample = allow.required_in_env_example
    .filter((k) => !exampleKeys.has(k))
    .sort();
  const leakedProductionManaged = allow.production_managed.filter((k) => exampleKeys.has(k)).sort();
  const deprecatedWarnings = [...deprecated].filter((k) => codeKeys.has(k)).sort();

  return { uncategorized, missingFromExample, leakedProductionManaged, deprecatedWarnings };
}

/** Filesystem-driven wrapper that reads code, .env.example, and the allowlist from disk. */
export function auditEnvCompleteness(opts: { repoRoot: string }): AuditResult {
  return computeAuditResult({
    codeKeys: readEnvKeysFromCode(opts.repoRoot),
    exampleKeys: readEnvExampleKeys(opts.repoRoot),
    allowlist: readAllowlist(opts.repoRoot),
  });
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = auditEnvCompleteness({ repoRoot });
  const lines: string[] = [];
  let fail = false;

  if (result.uncategorized.length) {
    fail = true;
    lines.push(`✗ Uncategorized env vars (${result.uncategorized.length}):`);
    for (const k of result.uncategorized) lines.push(`    ${k}`);
    lines.push("  → add each to scripts/env-allowlist.local-readiness.json");
  }
  if (result.missingFromExample.length) {
    fail = true;
    lines.push(`✗ Required keys missing from .env.example (${result.missingFromExample.length}):`);
    for (const k of result.missingFromExample) lines.push(`    ${k}`);
  }
  if (result.leakedProductionManaged.length) {
    fail = true;
    lines.push(`✗ production_managed keys leaked into .env.example:`);
    for (const k of result.leakedProductionManaged) lines.push(`    ${k}`);
  }
  if (result.deprecatedWarnings.length) {
    lines.push(`⚠ Deprecated env keys still read: ${result.deprecatedWarnings.join(", ")}`);
  }
  if (!fail) lines.push("✓ env-example completeness OK");

  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
