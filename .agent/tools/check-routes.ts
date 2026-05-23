#!/usr/bin/env tsx
import { Project, SourceFile } from "ts-morph";
import { resolve, relative } from "path";
import { execSync } from "child_process";
import { glob } from "glob";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findMutatingRouteHandlers } from "./routes.js";
import { reachesIngress } from "./reachability.js";
import { findApprovalMutations } from "./approval-mutations.js";
import {
  loadAllowlist,
  isAllowlisted,
  validateTemporaryEntries,
  type AllowlistEntry,
} from "./allowlist.js";
import { validateRouteClass, type ValidatorWarning } from "./route-class-validator.js";
import { runCrossAppTypesAdvisory } from "./cross-app-types-check.js";

export type FindingKind = "ingress" | "approval";

export interface Finding {
  path: string; // repo-relative
  line: number;
  kind: FindingKind;
  message: string;
}

export interface RunOptions {
  includePaths: string[]; // glob patterns (absolute or relative to cwd)
  allowlistPath: string;
  repoRoot: string;
}

export interface RunResult {
  findings: Finding[];
  suppressedCount: number;
  exitCode: number;
}

export async function runCheckRoutes(opts: RunOptions): Promise<RunResult> {
  const allowlist = loadAllowlist(opts.allowlistPath);

  const tempErrors = validateTemporaryEntries(allowlist);
  if (tempErrors.length > 0) {
    for (const err of tempErrors) {
      console.error(err); // eslint-disable-line no-console
    }
    return { findings: [], suppressedCount: 0, exitCode: 1 };
  }

  const files = (
    await Promise.all(opts.includePaths.map((p) => glob(p, { absolute: true, nodir: true })))
  ).flat();

  const project = new Project({ useInMemoryFileSystem: false });
  const sources: SourceFile[] = files
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => project.addSourceFileAtPath(f));

  const raw: Finding[] = [];

  for (const sf of sources) {
    const repoPath = relative(opts.repoRoot, sf.getFilePath());
    const handlers = findMutatingRouteHandlers(sf);
    if (handlers.length > 0 && !reachesIngress(sf)) {
      // One ingress finding per file (not per handler) — points at the first handler line.
      raw.push({
        path: repoPath,
        line: handlers[0].line,
        kind: "ingress",
        message: "mutating route handler does not reach PlatformIngress.submit",
      });
    }
    for (const m of findApprovalMutations(sf)) {
      raw.push({
        path: repoPath,
        line: m.line,
        kind: "approval",
        message: `direct write to approval state in route handler (${m.method})`,
      });
    }
  }

  const { kept, suppressed } = partitionByAllowlist(raw, allowlist);

  return {
    findings: kept,
    suppressedCount: suppressed.length,
    exitCode: kept.length === 0 ? 0 : 1,
  };
}

function partitionByAllowlist(
  findings: Finding[],
  allowlist: AllowlistEntry[],
): { kept: Finding[]; suppressed: Finding[] } {
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const f of findings) {
    if (isAllowlisted(f.path, allowlist)) suppressed.push(f);
    else kept.push(f);
  }
  return { kept, suppressed };
}

export function formatFinding(f: Finding): string {
  return `${f.path}:${f.line}: ${f.kind} — ${f.message}`;
}

export interface AdvisoryOptions {
  /** If omitted, detects via `git diff --name-only origin/main...HEAD`. */
  touchedFiles?: string[];
  repoRoot: string;
}

export interface AdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0;
}

const ROUTE_GLOBS: ReadonlyArray<RegExp> = [
  /^apps\/api\/src\/routes\//,
  /^apps\/chat\/src\/routes\//,
  /^apps\/dashboard\/src\/app\/api\//,
];

export async function runRouteClassAdvisory(opts: AdvisoryOptions): Promise<AdvisoryResult> {
  const touched = opts.touchedFiles ?? detectTouchedFiles();
  const routeFiles = touched.filter((f) => ROUTE_GLOBS.some((rx) => rx.test(f)));

  if (routeFiles.length === 0) {
    return { warnings: [], exitCode: 0 };
  }

  const project = new Project({ useInMemoryFileSystem: false });
  const warnings: ValidatorWarning[] = [];
  for (const repoPath of routeFiles) {
    const abs = join(opts.repoRoot, repoPath);
    try {
      const sf = project.addSourceFileAtPath(abs);
      warnings.push(...validateRouteClass(sf, repoPath));
    } catch {
      // File missing or unreadable — skip.
    }
  }

  return { warnings, exitCode: 0 };
}

function detectTouchedFiles(): string[] {
  try {
    const out = execSync("git diff --name-only origin/main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

// CLI entry point — only executed when run directly, not when imported by tests.
const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");

  const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
  if (mode === "warn-touched") {
    const touched = detectTouchedFiles();
    const [routeClass, crossAppTypes] = await Promise.all([
      runRouteClassAdvisory({ repoRoot, touchedFiles: touched }),
      runCrossAppTypesAdvisory({ repoRoot, touchedFiles: touched }),
    ]);
    const merged = [...routeClass.warnings, ...crossAppTypes.warnings];
    for (const w of merged) {
      console.warn(`::warning file=${w.path}::${w.message}`);
    }
    if (merged.length > 0) {
      console.warn(
        `\n${merged.length} advisory warning(s) — ${routeClass.warnings.length} route-class, ${crossAppTypes.warnings.length} cross-app-types.`,
      );
    }
    process.exit(0);
  }

  const result = await runCheckRoutes({
    includePaths: [
      join(repoRoot, "apps/api/src/routes/**/*.ts"),
      join(repoRoot, "apps/chat/src/routes/**/*.ts"),
      join(repoRoot, "apps/dashboard/src/app/api/**/route.ts"),
      join(repoRoot, "apps/dashboard/src/app/api/**/route.tsx"),
    ],
    allowlistPath: join(here, "route-allowlist.yaml"),
    repoRoot,
  });

  for (const f of result.findings) console.warn(formatFinding(f));
  if (result.suppressedCount > 0) {
    console.warn(`\n${result.suppressedCount} findings suppressed by allowlist.`);
  }
  process.exit(result.exitCode);
}
