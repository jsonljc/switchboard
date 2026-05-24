import type { SourceFile } from "ts-morph";

export type RouteClass =
  | "operator-direct"
  | "lifecycle"
  | "control-plane"
  | "ingress-receiver"
  | "read-only"
  | "dashboard-proxy";

const KNOWN_CLASSES: ReadonlySet<RouteClass> = new Set([
  "operator-direct",
  "lifecycle",
  "control-plane",
  "ingress-receiver",
  "read-only",
  "dashboard-proxy",
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
 * Regex for the dashboard-proxy directory convention.
 *
 * Only routes under `apps/dashboard/src/app/api/dashboard/**` are blessed as
 * forwarding proxies (spec §1: "A route under
 * apps/dashboard/src/app/api/dashboard/** is always dashboard proxy").
 *
 * Routes under `apps/dashboard/src/app/api/` but OUTSIDE `/dashboard/` (e.g.
 * `waitlist/route.ts` which does a direct `db.waitlistEntry.create`, and the
 * `auth/*` routes) are NOT forwarding proxies — they must carry explicit
 * `@route-class` headers and must NOT silently default to `dashboard-proxy`.
 */
const DASHBOARD_PROXY_RX = /^apps\/dashboard\/src\/app\/api\/dashboard\//;

/**
 * Resolve the route class for a source file, applying the dashboard-proxy
 * directory convention as a fallback when no explicit header is present.
 *
 * Resolution order:
 * 1. If `parseRouteClass(sf)` returns a non-null class (explicit header), use it.
 * 2. Else, if `repoPath` matches the dashboard-proxy directory convention
 *    (`apps/dashboard/src/app/api/dashboard/**`), return `"dashboard-proxy"`.
 * 3. Else return `null` (missing header — enforced as an error later by
 *    --mode=error, not here).
 */
export function resolveRouteClass(sf: SourceFile, repoPath: string): RouteClass | null {
  const explicit = parseRouteClass(sf);
  if (explicit !== null) return explicit;
  if (DASHBOARD_PROXY_RX.test(repoPath)) return "dashboard-proxy";
  return null;
}

/** Matches the `operator-direct-contract-deferred` directive comment token. */
const DEFERRAL_DIRECTIVE_RX = /\/\/\s*route-governance:\s*operator-direct-contract-deferred\b/;

/** Matches a GitHub issue reference such as `#654`. */
const ISSUE_REF_RX = /#\d+/;

/**
 * Detect whether `text` carries an `operator-direct-contract-deferred` directive,
 * and — if so — whether a GitHub issue reference (`#\d+`) appears on the same
 * directive comment line OR within the 3 lines immediately following it.
 *
 * Returns `{ deferred: false }` when the directive is absent.
 * Returns `{ deferred: true, hasIssueRef: boolean }` when it is present.
 */
function hasOperatorDirectDeferral(
  text: string,
): { deferred: false } | { deferred: true; hasIssueRef: boolean } {
  const directiveMatch = DEFERRAL_DIRECTIVE_RX.exec(text);
  if (!directiveMatch) return { deferred: false };

  // Find the directive line and up to 3 following lines.
  const directiveIndex = directiveMatch.index;
  const lineStart = text.lastIndexOf("\n", directiveIndex - 1) + 1;
  // Collect: directive line + 3 subsequent newline-delimited segments.
  let searchEnd = directiveIndex;
  let newlinesFound = 0;
  while (searchEnd < text.length && newlinesFound <= 3) {
    if (text[searchEnd] === "\n") newlinesFound += 1;
    searchEnd += 1;
  }
  const window = text.slice(lineStart, searchEnd);
  return { deferred: true, hasIssueRef: ISSUE_REF_RX.test(window) };
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
    // Check for the contract-deferred deferral directive before running cell checks.
    // Routes that carry the directive skip idempotency + write-side-decorator enforcement
    // until the tracked migration issue is resolved (Route Governance §6).
    const deferral = hasOperatorDirectDeferral(sf.getFullText());
    if (deferral.deferred) {
      if (!deferral.hasIssueRef) {
        // Directive present but no issue ref in scope — the ONLY warning emitted.
        warnings.push({
          path: repoPath,
          message:
            "operator-direct route carries a 'operator-direct-contract-deferred' directive without a tracked issue reference (e.g. #654) — ref-less deferrals are forbidden (Route Governance §6)",
        });
      }
      // Whether or not there is an issue ref, skip the cell enforcement below.
      return warnings;
    }

    // No deferral directive — run the full three-stage cell checks.
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
