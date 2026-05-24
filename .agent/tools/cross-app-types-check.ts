import {
  Project,
  Node,
  type SourceFile,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
} from "ts-morph";
import { join } from "path";
import type { ValidatorWarning } from "./route-class-validator.js";

const APP_SRC_RX = /^apps\/(api|chat|dashboard)\/src\//;
const TESTS_RX = /\/__tests__\//;
const SUPPRESS_DIRECTIVE_RX = /\/\/\s*route-governance:\s*local-view-model\b/;

export interface CrossAppTypesAdvisoryOptions {
  /** Repo-relative paths to scan. */
  touchedFiles: string[];
  /** Absolute repo root. */
  repoRoot: string;
}

export interface CrossAppTypesAdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0;
}

/**
 * Walk the schemas barrel's resolved exports; return the set of exported
 * interface + type-alias names (the cross-app *type* surface). Value exports
 * (Zod schema consts) are excluded — only their inferred types matter.
 */
export function enumerateSchemaTypeNames(project: Project, indexRelPath: string): Set<string> {
  const index = project.getSourceFile((sf) => sf.getFilePath().endsWith(indexRelPath));
  if (!index) return new Set();
  const names = new Set<string>();
  for (const [name, decls] of index.getExportedDeclarations()) {
    if (decls.some((d) => Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d))) {
      names.add(name);
    }
  }
  return names;
}

export async function runCrossAppTypesAdvisory(
  opts: CrossAppTypesAdvisoryOptions,
): Promise<CrossAppTypesAdvisoryResult> {
  const inScope = opts.touchedFiles.filter(
    (f) => APP_SRC_RX.test(f) && !TESTS_RX.test(f) && (f.endsWith(".ts") || f.endsWith(".tsx")),
  );
  if (inScope.length === 0) return { warnings: [], exitCode: 0 };

  const project = new Project({ useInMemoryFileSystem: false });
  let schemaNames: ReadonlySet<string>;
  try {
    project.addSourceFilesAtPaths(join(opts.repoRoot, "packages/schemas/src/**/*.ts"));
    schemaNames = enumerateSchemaTypeNames(project, "packages/schemas/src/index.ts");
  } catch {
    schemaNames = new Set(); // schemas unreadable — degrade to no-op rather than crash CI
  }

  const warnings: ValidatorWarning[] = [];

  for (const repoPath of inScope) {
    const abs = join(opts.repoRoot, repoPath);
    let sf: SourceFile;
    try {
      sf = project.addSourceFileAtPath(abs);
    } catch {
      continue; // file missing — skip silently
    }
    warnings.push(...scanFile(sf, repoPath, schemaNames));
  }

  return { warnings, exitCode: 0 };
}

export function scanFile(
  sf: SourceFile,
  repoPath: string,
  schemaNames: ReadonlySet<string>,
): ValidatorWarning[] {
  const out: ValidatorWarning[] = [];
  for (const decl of [...sf.getInterfaces(), ...sf.getTypeAliases()]) {
    if (!decl.isExported()) continue;
    const name = decl.getName();
    if (!schemaNames.has(name)) continue;
    if (hasSuppressDirective(decl)) continue;
    out.push({
      path: repoPath,
      message: `local '${name}' duplicates @switchboard/schemas export — import { ${name} } from "@switchboard/schemas" instead, or annotate the declaration with '// route-governance: local-view-model' if a deliberately narrower local shape`,
    });
  }
  return out;
}

function hasSuppressDirective(decl: InterfaceDeclaration | TypeAliasDeclaration): boolean {
  // ts-morph: getLeadingCommentRanges returns the comments immediately above
  // the declaration node. Single-line comments lose newlines; we just need to
  // match the directive regex against their text.
  const ranges = decl.getLeadingCommentRanges();
  for (const r of ranges) {
    if (SUPPRESS_DIRECTIVE_RX.test(r.getText())) return true;
  }
  return false;
}
