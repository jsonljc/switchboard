import {
  Project,
  type SourceFile,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  Node,
} from "ts-morph";
import { join } from "path";
import type { ValidatorWarning } from "./route-class-validator.js";

const STORE_SRC_RX = /^packages\/db\/src\/(stores|storage)\//;
const TESTS_RX = /\/__tests__\//;
const MUTATION_METHODS = new Set(["update", "updateMany", "delete", "deleteMany"]);
const SUPPRESS_DIRECTIVE_RX = /\/\/\s*route-governance:\s*store-mutation-(global|deferred)\b/;

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
    if (mutationWhereHasOrgFilter(call)) continue;

    out.push({
      path: repoPath,
      message: `Prisma '${method}' near line ${callStartLine} has no organizationId/orgId in its WHERE clause — scope the where object (audit §10) or annotate '// route-governance: store-mutation-global' if genuinely global`,
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

const ORG_KEYS = new Set(["organizationId", "orgId"]);

/** True if the call's first-arg object literal has a `where` whose object
 *  literal carries an org key directly, or a relation key whose nested object
 *  literal carries one. Accepts a `where` bound to a same-scope const whose
 *  initializer is a resolvable object literal. Conservative: returns false
 *  when `where` is absent, or built from an unresolvable expression. */
function mutationWhereHasOrgFilter(call: CallExpression): boolean {
  const arg = call.getArguments()[0];
  if (!arg || !Node.isObjectLiteralExpression(arg)) return false;
  const whereProp = arg.getProperty("where");
  const whereObj = resolveWhereObject(whereProp);
  return whereObj ? objectHasOrgKey(whereObj) : false;
}

/** Resolve the `where` value to an object literal. Handles inline
 *  `where: { ... }`, `where: identifier`, and the `where` shorthand — the
 *  latter two resolved when the identifier is a same-file const with an
 *  object-literal initializer (no cross-file dataflow). */
function resolveWhereObject(
  whereProp: ReturnType<ObjectLiteralExpression["getProperty"]>,
): ObjectLiteralExpression | null {
  if (!whereProp) return null;
  if (Node.isPropertyAssignment(whereProp)) {
    const init = whereProp.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) return init;
    if (init && Node.isIdentifier(init)) return resolveIdentifierToObjectLiteral(init);
    return null;
  }
  if (Node.isShorthandPropertyAssignment(whereProp)) {
    const nameNode = whereProp.getNameNode();
    if (Node.isIdentifier(nameNode)) return resolveIdentifierToObjectLiteral(nameNode);
  }
  return null;
}

function resolveIdentifierToObjectLiteral(id: Node): ObjectLiteralExpression | null {
  if (!Node.isIdentifier(id)) return null;
  for (const def of id.getDefinitions()) {
    const declNode = def.getDeclarationNode();
    if (declNode && Node.isVariableDeclaration(declNode)) {
      const init = declNode.getInitializer();
      if (init && Node.isObjectLiteralExpression(init)) return init;
    }
  }
  return null;
}

/** Org key directly present, OR any nested object-literal value carries one
 *  (relation nesting: `deployment: { organizationId }`). */
function objectHasOrgKey(obj: ObjectLiteralExpression): boolean {
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
      const name = prop.getName();
      if (ORG_KEYS.has(name)) return true;
      if (Node.isPropertyAssignment(prop)) {
        const init = prop.getInitializer();
        if (init && Node.isObjectLiteralExpression(init) && objectHasOrgKey(init)) return true;
      }
    }
  }
  return false;
}
