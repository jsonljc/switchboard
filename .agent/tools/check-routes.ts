#!/usr/bin/env tsx
import { Project, SourceFile } from "ts-morph";
import { resolve, relative } from "path";
import { glob } from "glob";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findMutatingRouteHandlers } from "./routes.js";
import { reachesIngress } from "./reachability.js";
import { findApprovalMutations } from "./approval-mutations.js";
import { loadAllowlist, isAllowlisted, type AllowlistEntry } from "./allowlist.js";

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
