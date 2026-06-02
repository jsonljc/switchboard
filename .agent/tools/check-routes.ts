#!/usr/bin/env tsx
import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";
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
import {
  validateRouteClass,
  validateControlPlaneOrgGuard,
  resolveRouteClass,
  type ValidatorWarning,
} from "./route-class-validator.js";
import { runCrossAppTypesAdvisory, enumerateSchemaTypeNames } from "./cross-app-types-check.js";
import { runStoreMutationAdvisory } from "./store-mutation-check.js";

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

/**
 * WARN-ONLY control-plane org-guard advisory (Route Governance §12).
 *
 * Maps `validateControlPlaneOrgGuard` over the in-scope route files. Returns
 * advisory warnings ONLY — callers print these as `::warning::` and must NOT
 * fold them into `violations` or the exitCode. This catches NEW unguarded
 * mutating control-plane routes without blocking CI on the existing un-migrated
 * ones (full enforcement staged behind #654; see route-class-validator.ts).
 *
 * `exitCode` is fixed at 0 to make the non-blocking contract explicit.
 */
export async function runControlPlaneOrgGuardAdvisory(
  opts: AdvisoryOptions,
): Promise<AdvisoryResult> {
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
      warnings.push(...validateControlPlaneOrgGuard(sf, repoPath));
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

// ---------------------------------------------------------------------------
// --mode=error : repo-wide enforcement (Route Governance Contract v1 PR-4C)
// ---------------------------------------------------------------------------

export interface ErrorModeOptions {
  repoRoot: string;
}

export interface ErrorModeResult {
  violations: ValidatorWarning[];
  /**
   * WARN-ONLY control-plane org-guard advisories (Route Governance §12).
   * Printed as `::warning::` and deliberately EXCLUDED from `violations` and
   * the exitCode — they must never fail error-mode. See #654.
   */
  controlPlaneAdvisories: ValidatorWarning[];
  missingHeaders: string[];
  schemaEnumEmpty: boolean;
  exitCode: 0 | 1;
}

// 'register' is intentionally excluded: route modules declare routes via app.<verb>("/path", ...);
// app.register(...) is plugin wiring done in app.ts, not a route declaration.
const FASTIFY_ROUTE_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "route",
  "all",
  "head",
  "options",
]);

/**
 * True iff the file registers a real route: a CallExpression whose callee is a
 * PropertyAccessExpression with a route-registering method name AND whose first
 * argument is a string literal (the route path). The string-literal-first-arg
 * requirement distinguishes `app.get("/x", ...)` (a route) from
 * `cartridges.get(cartridgeId)` (a Map access — identifier arg).
 */
export function fileRegistersFastifyRoute(sf: SourceFile): boolean {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (!FASTIFY_ROUTE_METHODS.has(expr.getName())) continue;
    const first = call.getArguments()[0];
    if (!first) continue;
    if (
      first.getKind() === SyntaxKind.StringLiteral ||
      first.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      return true;
    }
  }
  return false;
}

async function globRepoRelative(repoRoot: string, patterns: string[]): Promise<string[]> {
  const abs = (
    await Promise.all(patterns.map((p) => glob(join(repoRoot, p), { absolute: true, nodir: true })))
  ).flat();
  const rel = abs.map((a) => relative(repoRoot, a));
  return rel.filter((p) => !p.includes("__tests__"));
}

const DASHBOARD_API_PREFIX = "apps/dashboard/src/app/api/";

export async function runErrorMode(opts: ErrorModeOptions): Promise<ErrorModeResult> {
  const { repoRoot } = opts;

  // (a) Glob in-scope sets repo-wide.
  const routeFiles = await globRepoRelative(repoRoot, [
    "apps/api/src/routes/**/*.ts",
    "apps/chat/src/routes/**/*.ts",
    "apps/dashboard/src/app/api/**/route.ts",
    "apps/dashboard/src/app/api/**/route.tsx",
  ]);
  const storeFiles = await globRepoRelative(repoRoot, [
    "packages/db/src/stores/**/*.ts",
    "packages/db/src/storage/**/*.ts",
    // Audit L8-F4: top-level db stores (recommendation-store.ts, prisma-consent-store.ts,
    // …) live at the src root, not under stores/. Scope them so cross-tenant mutations
    // there are caught (runStoreMutationAdvisory re-filters via isStoreFileInScope).
    "packages/db/src/*-store.ts",
  ]);
  const appTypeFiles = await globRepoRelative(repoRoot, [
    "apps/api/src/**/*.ts",
    "apps/api/src/**/*.tsx",
    "apps/chat/src/**/*.ts",
    "apps/chat/src/**/*.tsx",
    "apps/dashboard/src/**/*.ts",
    "apps/dashboard/src/**/*.tsx",
  ]);

  // (b) Header presence — with route-registration detection.
  const missingHeaders: string[] = [];
  const headerProject = new Project({ useInMemoryFileSystem: false });
  for (const repoPath of routeFiles) {
    let sf: SourceFile;
    try {
      sf = headerProject.addSourceFileAtPath(join(repoRoot, repoPath));
    } catch {
      continue;
    }
    const isDashboard = repoPath.startsWith(DASHBOARD_API_PREFIX);
    if (isDashboard) {
      // Next.js convention: every route.ts(x) is a route. /dashboard/** resolves
      // to dashboard-proxy; outliers must carry explicit headers.
      if (resolveRouteClass(sf, repoPath) === null) missingHeaders.push(repoPath);
    } else {
      // apps/api or apps/chat: only flag files that actually register a route.
      if (fileRegistersFastifyRoute(sf) && resolveRouteClass(sf, repoPath) === null) {
        missingHeaders.push(repoPath);
      }
    }
  }

  // (c) Empty-schemaNames hard failure (carry-over).
  let schemaEnumEmpty = false;
  try {
    const schemaProject = new Project({ useInMemoryFileSystem: false });
    schemaProject.addSourceFilesAtPaths(join(repoRoot, "packages/schemas/src/**/*.ts"));
    const names = enumerateSchemaTypeNames(schemaProject, "packages/schemas/src/index.ts");
    if (names.size === 0) schemaEnumEmpty = true;
  } catch {
    schemaEnumEmpty = true;
  }

  // (d) Run the three BLOCKING advisories + the WARN-ONLY control-plane advisory
  // repo-wide. The control-plane org-guard advisory is intentionally kept
  // OUT of `violations` (and out of the exitCode below) — it is non-blocking.
  const [routeClass, crossAppTypes, storeMutation, controlPlaneOrgGuard] = await Promise.all([
    runRouteClassAdvisory({ repoRoot, touchedFiles: routeFiles }),
    runCrossAppTypesAdvisory({ repoRoot, touchedFiles: appTypeFiles }),
    runStoreMutationAdvisory({ repoRoot, touchedFiles: storeFiles }),
    runControlPlaneOrgGuardAdvisory({ repoRoot, touchedFiles: routeFiles }),
  ]);
  const violations = [...routeClass.warnings, ...crossAppTypes.warnings, ...storeMutation.warnings];
  const controlPlaneAdvisories = controlPlaneOrgGuard.warnings;

  // (e) exitCode — controlPlaneAdvisories deliberately NOT included (warn-only).
  const exitCode: 0 | 1 =
    violations.length > 0 || missingHeaders.length > 0 || schemaEnumEmpty ? 1 : 0;

  return { violations, controlPlaneAdvisories, missingHeaders, schemaEnumEmpty, exitCode };
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
    const [routeClass, crossAppTypes, storeMutation, controlPlaneOrgGuard] = await Promise.all([
      runRouteClassAdvisory({ repoRoot, touchedFiles: touched }),
      runCrossAppTypesAdvisory({ repoRoot, touchedFiles: touched }),
      runStoreMutationAdvisory({ repoRoot, touchedFiles: touched }),
      runControlPlaneOrgGuardAdvisory({ repoRoot, touchedFiles: touched }),
    ]);
    const merged = [
      ...routeClass.warnings,
      ...crossAppTypes.warnings,
      ...storeMutation.warnings,
      ...controlPlaneOrgGuard.warnings,
    ];
    for (const w of merged) {
      console.warn(`::warning file=${w.path}::${w.message}`);
    }
    if (merged.length > 0) {
      console.warn(
        `\n${merged.length} advisory warning(s) — ${routeClass.warnings.length} route-class, ${crossAppTypes.warnings.length} cross-app-types, ${storeMutation.warnings.length} store-mutation, ${controlPlaneOrgGuard.warnings.length} control-plane-org-guard.`,
      );
    }
    process.exit(0);
  }

  if (mode === "error") {
    const r = await runErrorMode({ repoRoot });
    if (r.schemaEnumEmpty) {
      console.error(
        `::error::schemas type enumeration yielded 0 names — cross-app-types check would be a silent no-op (validator malfunction); aborting`,
      );
    }
    for (const p of r.missingHeaders) {
      console.error(
        `::error file=${p}::missing or invalid @route-class header (Route Governance §1)`,
      );
    }
    for (const w of r.violations) {
      console.error(`::error file=${w.path}::${w.message}`);
    }
    // WARN-ONLY: control-plane org-guard advisories print as ::warning:: and do
    // NOT affect r.exitCode (Route Governance §12; tracked: #654).
    for (const w of r.controlPlaneAdvisories) {
      console.warn(`::warning file=${w.path}::${w.message}`);
    }
    if (r.violations.length > 0 || r.missingHeaders.length > 0 || r.schemaEnumEmpty) {
      console.error(
        `\n${r.violations.length} matrix/type/store violation(s) + ${r.missingHeaders.length} missing header(s)${r.schemaEnumEmpty ? " + schema-enum malfunction" : ""}.`,
      );
    }
    if (r.controlPlaneAdvisories.length > 0) {
      console.warn(
        `\n${r.controlPlaneAdvisories.length} control-plane org-guard advisory warning(s) (non-blocking; Route Governance §12, tracked: #654).`,
      );
    }
    process.exit(r.exitCode);
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
