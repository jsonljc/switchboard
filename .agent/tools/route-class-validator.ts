import type { SourceFile } from "ts-morph";

export type RouteClass =
  | "operator-direct"
  | "lifecycle"
  | "control-plane"
  | "ingress-receiver"
  | "read-only";

const KNOWN_CLASSES: ReadonlySet<RouteClass> = new Set([
  "operator-direct",
  "lifecycle",
  "control-plane",
  "ingress-receiver",
  "read-only",
]);

export interface ValidatorWarning {
  path: string;
  message: string;
}

/**
 * Parse the `// @route-class: <name>` header comment from a source file.
 * Returns null when the header is absent or names an unknown class.
 */
export function parseRouteClass(sf: SourceFile): RouteClass | null {
  const text = sf.getFullText();
  const head = text.slice(0, 2048);
  const match = /\/\/\s*@route-class:\s*([a-z-]+)/.exec(head);
  if (!match) return null;
  const label = match[1] as RouteClass;
  return KNOWN_CLASSES.has(label) ? label : null;
}

/**
 * Per-class matrix validator for Route Governance Contract v1 PR-1.
 *
 * Returns warnings (not errors) for non-conformant cells. CI prints these as
 * advisory output via `--mode=warn-touched`. PR-4 flips to errors after the
 * full route-class backfill is in place.
 *
 * PR-1 scope: only validates operator-direct and read-only routes; other
 * classes are relaxed until PR-4.
 *
 * **Validation strategy — three-stage AST checks, not just imports.**
 *
 * For each rule (e.g., "operator-direct must use requireIdempotencyKey"):
 *
 * 1. *Import check* — is the helper imported? If not, warn "should import."
 *    Without an import, no later check fires (you can't call what you don't
 *    have). The import-presence warning is the entry point.
 * 2. *Usage check* — is the helper actually called/referenced in the file?
 *    Catches the "imports but forgets" failure mode. Uses
 *    `getDescendantsOfKind(SyntaxKind.CallExpression)` + identifier scans, not
 *    just import declarations.
 * 3. *Cardinality check* — for `requireIdempotencyKey`, does the call count
 *    match the number of mutating-verb route registrations (POST/PATCH/PUT/
 *    DELETE)? Catches the "imports + uses on handler A but forgets on handler
 *    B" failure mode. GET handlers are NOT counted — read-only handlers in
 *    operator-direct files (e.g., the mixed admin-consent.ts GET) are exempt.
 *
 * Each stage produces at most one warning per rule. The validator returns the
 * union of stage warnings; routes can have multiple warnings if multiple
 * rules fail.
 */
export function validateRouteClass(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const cls = parseRouteClass(sf);
  if (cls === null) return [];

  const warnings: ValidatorWarning[] = [];

  const importsNamed = (name: string) =>
    sf.getImportDeclarations().some((d) => d.getNamedImports().some((n) => n.getName() === name));

  const callsNamed = (name: string): number => {
    // Count CallExpression nodes whose callee is the bare Identifier `name`.
    // We deliberately use Identifier-kind + strict equality (mirroring the
    // requireOrgForMutation check below) rather than `endsWith(name)` so a
    // local wrapper like `wrapRequireIdempotencyKey(...)` does not
    // false-count and mask the cardinality check. See PR #614 ultrareview
    // bug_005.
    let count = 0;
    sf.forEachDescendant((node) => {
      if (node.getKindName() !== "CallExpression") return;
      const expr = (
        node as {
          getExpression?: () => { getKindName: () => string; getText: () => string };
        }
      ).getExpression?.();
      if (expr?.getKindName() === "Identifier" && expr.getText() === name) count += 1;
    });
    return count;
  };

  const WRITE_SIDE_DECORATORS = ["requireOrgForMutation", "requireOrgForAuditedMutation"] as const;
  const importsAnyWriteSide = () => WRITE_SIDE_DECORATORS.some((n) => importsNamed(n));
  const writeSideIdentifierCount = (): number => {
    let count = 0;
    sf.forEachDescendant((node) => {
      if (node.getKindName() !== "Identifier") return;
      if ((WRITE_SIDE_DECORATORS as readonly string[]).includes(node.getText())) count += 1;
    });
    return count;
  };

  const countMutatingRoutes = (): number => {
    let count = 0;
    sf.forEachDescendant((node) => {
      if (node.getKindName() !== "CallExpression") return;
      const expr = (
        node as unknown as { getExpression: () => { getText: () => string } }
      ).getExpression();
      const text = expr.getText();
      if (/\.(post|patch|delete|put)$/.test(text)) count += 1;
    });
    return count;
  };

  if (cls === "operator-direct") {
    if (!importsNamed("requireIdempotencyKey")) {
      warnings.push({
        path: repoPath,
        message:
          "operator-direct route should import requireIdempotencyKey (spec §7.1: Idempotency-Key is mandatory)",
      });
    } else if (callsNamed("requireIdempotencyKey") === 0) {
      warnings.push({
        path: repoPath,
        message:
          "operator-direct route imports requireIdempotencyKey but never calls it (spec §7.1)",
      });
    } else if (countMutatingRoutes() > callsNamed("requireIdempotencyKey")) {
      warnings.push({
        path: repoPath,
        message: `operator-direct route registers ${countMutatingRoutes()} mutating handler(s) but only calls requireIdempotencyKey ${callsNamed("requireIdempotencyKey")} time(s) (spec §7.1: each mutating handler must call it)`,
      });
    }

    if (!importsAnyWriteSide()) {
      warnings.push({
        path: repoPath,
        message:
          "operator-direct route should import a write-side decorator (requireOrgForMutation or requireOrgForAuditedMutation; spec §6 + §3 matrix)",
      });
    } else if (writeSideIdentifierCount() < 2) {
      // Identifier count < 2 means the symbol appears only at the import site.
      // Two occurrences = import + at least one preHandler use.
      warnings.push({
        path: repoPath,
        message:
          "operator-direct route imports a write-side decorator but does not register it as a preHandler (spec §6)",
      });
    }
  }

  if (cls === "read-only") {
    if (importsAnyWriteSide()) {
      warnings.push({
        path: repoPath,
        message:
          "read-only route should not import a write-side decorator (use requireOrg for read-side; spec §3 matrix)",
      });
    }
  }

  return warnings;
}
