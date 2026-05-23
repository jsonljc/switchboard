import { Project, type SourceFile, SyntaxKind, type CallExpression } from "ts-morph";
import { join } from "path";
import type { ValidatorWarning } from "./route-class-validator.js";

const STORE_SRC_RX = /^packages\/db\/src\/(stores|storage)\//;
const TESTS_RX = /\/__tests__\//;
const MUTATION_METHODS = new Set(["update", "updateMany", "delete", "deleteMany"]);
const SUPPRESS_DIRECTIVE_RX = /\/\/\s*route-governance:\s*store-mutation-global\b/;
const ORG_TOKEN_RX = /\b(organizationId|orgId)\b/;
const WINDOW_LINES = 10;

export interface StoreMutationAdvisoryOptions {
  touchedFiles: string[];
  repoRoot: string;
}
export interface StoreMutationAdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0;
}

export async function runStoreMutationAdvisory(
  opts: StoreMutationAdvisoryOptions,
): Promise<StoreMutationAdvisoryResult> {
  const inScope = opts.touchedFiles.filter(
    (f) => STORE_SRC_RX.test(f) && !TESTS_RX.test(f) && f.endsWith(".ts"),
  );
  if (inScope.length === 0) return { warnings: [], exitCode: 0 };

  const project = new Project({ useInMemoryFileSystem: false });
  const warnings: ValidatorWarning[] = [];
  for (const repoPath of inScope) {
    const abs = join(opts.repoRoot, repoPath);
    let sf: SourceFile;
    try {
      sf = project.addSourceFileAtPath(abs);
    } catch {
      continue;
    }
    warnings.push(...scanStoreFileForTest(sf, repoPath));
  }
  return { warnings, exitCode: 0 };
}

// Exported for unit tests.
export function scanStoreFileForTest(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const out: ValidatorWarning[] = [];
  const fullText = sf.getFullText();
  const lines = fullText.split("\n");

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const method = getMutationMethod(call);
    if (!method) continue;

    const callStartLine = call.getStartLineNumber(); // 1-based
    if (hasSuppressDirectiveAbove(lines, callStartLine)) continue;
    if (windowHasOrgToken(lines, callStartLine)) continue;

    out.push({
      path: repoPath,
      message: `Prisma '${method}' near line ${callStartLine} has no organizationId/orgId in its tenant filter — scope the WHERE clause (audit §10) or annotate '// route-governance: store-mutation-global' if genuinely global`,
    });
  }
  return out;
}

function getMutationMethod(call: CallExpression): string | null {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const name = expr.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
  return MUTATION_METHODS.has(name) ? name : null;
}

function hasSuppressDirectiveAbove(lines: string[], callLine: number): boolean {
  for (let i = Math.max(0, callLine - 4); i < callLine; i++) {
    if (SUPPRESS_DIRECTIVE_RX.test(lines[i] ?? "")) return true;
  }
  return false;
}

function windowHasOrgToken(lines: string[], callLine: number): boolean {
  const start = Math.max(0, callLine - 1 - WINDOW_LINES);
  const end = Math.min(lines.length, callLine + WINDOW_LINES);
  return ORG_TOKEN_RX.test(lines.slice(start, end).join("\n"));
}
