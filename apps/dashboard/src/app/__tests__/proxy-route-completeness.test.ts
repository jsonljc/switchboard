import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Dashboard -> API proxy-route completeness regression guard.
 *
 * Every BROWSER fetch to a `/api/dashboard/...` path must resolve to an
 * existing Next.js proxy route file under
 * `apps/dashboard/src/app/api/dashboard/.../route.ts`. The dashboard never
 * talks to the Fastify API directly from the browser — each client call hits a
 * same-origin Next proxy route (`requireSession` -> `getApiClient` -> client
 * method -> `NextResponse`). If a hook fetches a `/api/dashboard/...` path that
 * has no proxy route file, the live app 404s. Fetch-mocked unit tests cannot
 * catch that gap because they stub the network — only a browser/curl path does.
 * This test reconstructs that path-coverage check statically from the
 * filesystem so the gap fails CI instead of production.
 *
 * Algorithm:
 *  1. Routes R: enumerate `app/api/dashboard/**\/route.ts`; the path between
 *     `app/api/dashboard/` and `/route.ts` is the route template, split into
 *     segments with `[seg]` dynamic segments normalized to the wildcard `:p`.
 *  2. Browser fetch paths F: scan browser source (hooks, components, app) —
 *     excluding the proxies themselves, the server-side api-client, tests, and
 *     middleware — for STRING/TEMPLATE LITERALS beginning `/api/dashboard/`.
 *     For each, take the STATIC PREFIX: the substring after `/api/dashboard/`
 *     up to (but not including) the first `${`, `?`, backtick, or quote, with a
 *     trailing `/` trimmed. (Conservative: a parametrized tail like
 *     `agents/${id}/pipeline` collapses to its static head `agents`.)
 *  3. Assert each F path prefix-matches some R route: R has at least as many
 *     segments as F, and for every i in F's range `R[i] === ":p" || R[i] === F[i]`.
 *     This proves a proxy namespace exists for the resource without
 *     false-positiving on dynamic tails the static prefix can't see.
 */

// Resolve the dashboard root from this test file's location rather than
// process.cwd(), so the walk is stable regardless of where vitest is invoked.
// __dirname here is `<dashboard>/src/app/__tests__`.
const SRC_DIR = join(__dirname, "..", "..");
const API_DASHBOARD_DIR = join(SRC_DIR, "app", "api", "dashboard");

/**
 * One known, intentional gap. `useSendWhatsAppTest`
 * (`src/hooks/use-whatsapp-send-test.ts`) POSTs to
 * `/api/dashboard/whatsapp/send-test`, but the proxy route + the server
 * api-client method are not built yet: this is in-progress WhatsApp
 * Tech-Provider work pending Meta App Review, NOT a regression. Encoded as the
 * static-prefix string the algorithm would produce for that fetch. The
 * "allowlist is minimal" test below fails if this entry stops being referenced
 * by any browser file, so the allowlist cannot rot once the route lands.
 */
const KNOWN_PENDING_PROXIES = new Set(["whatsapp/send-test"]);

const toPosix = (p: string): string => p.split(sep).join("/");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Route template segments, with dynamic `[seg]` normalized to `:p`. */
function routeSegments(routeFile: string): string[] {
  const rel = toPosix(relative(API_DASHBOARD_DIR, routeFile)).replace(/\/route\.ts$/, "");
  return rel.split("/").map((s) => (s.startsWith("[") && s.endsWith("]") ? ":p" : s));
}

function enumerateRoutes(): string[][] {
  return walk(API_DASHBOARD_DIR)
    .filter((f) => f.endsWith(`${sep}route.ts`))
    .map(routeSegments);
}

function isBrowserSourceFile(relPosix: string): boolean {
  if (!/\.(ts|tsx)$/.test(relPosix)) return false;
  // The proxies themselves call the backend server-side — not browser fetches.
  if (relPosix.startsWith("app/api/")) return false;
  // The server-side api-client (requireSession path) is not a browser fetch.
  if (relPosix.startsWith("lib/api-client/")) return false;
  // Tests stub the network; their literals are not real browser fetches.
  if (relPosix.split("/").includes("__tests__")) return false;
  if (/\.test\./.test(relPosix)) return false;
  if (relPosix === "middleware.ts") return false;
  return true;
}

const MARKER = "/api/dashboard/";
// Terminators of the static prefix (first dynamic/string boundary after the marker).
const STOP_TOKENS = ["${", "?", "`", '"', "'"];

/**
 * Extract distinct STATIC-PREFIX F paths from one browser file. Only counts the
 * marker when it opens a string/template literal (the char immediately before
 * it is `"`, `'`, or a backtick) — this excludes prose/JSDoc mentions of
 * `/api/dashboard/...`, which are not real fetches and would otherwise run on
 * into comment text and produce false-positives.
 */
function extractStaticPrefixes(source: string): string[] {
  const prefixes: string[] = [];
  let from = 0;
  let idx = source.indexOf(MARKER, from);
  while (idx !== -1) {
    from = idx + MARKER.length;
    const before = idx > 0 ? source[idx - 1] : "";
    if (before === '"' || before === "'" || before === "`") {
      const rest = source.slice(idx + MARKER.length);
      let end = rest.length;
      for (const tok of STOP_TOKENS) {
        const at = rest.indexOf(tok);
        if (at !== -1 && at < end) end = at;
      }
      const prefix = rest.slice(0, end).replace(/\/$/, "");
      if (prefix !== "") prefixes.push(prefix);
    }
    idx = source.indexOf(MARKER, from);
  }
  return prefixes;
}

interface FetchPath {
  prefix: string;
  // First browser file (relative posix path) seen referencing this prefix.
  source: string;
}

function enumerateFetchPaths(): FetchPath[] {
  const roots = ["hooks", "components", "app"].map((r) => join(SRC_DIR, r));
  const files = roots.flatMap(walk);
  const byPrefix = new Map<string, string>();
  for (const file of files) {
    const rel = toPosix(relative(SRC_DIR, file));
    if (!isBrowserSourceFile(rel)) continue;
    for (const prefix of extractStaticPrefixes(readFileSync(file, "utf8"))) {
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, rel);
    }
  }
  return [...byPrefix.entries()].map(([prefix, source]) => ({ prefix, source }));
}

/**
 * True when some route R prefix-matches the fetch segments F: R has at least as
 * many segments as F, and every F segment equals the R segment or the R segment
 * is the `:p` wildcard.
 */
function hasMatchingRoute(fetchSegments: string[], routes: string[][]): boolean {
  return routes.some((route) => {
    if (route.length < fetchSegments.length) return false;
    for (let i = 0; i < fetchSegments.length; i++) {
      const r = route[i];
      if (r !== ":p" && r !== fetchSegments[i]) return false;
    }
    return true;
  });
}

const routes = enumerateRoutes();
const fetchPaths = enumerateFetchPaths();

describe("dashboard -> API proxy-route completeness", () => {
  it("enumerates routes and browser fetch paths from the filesystem", () => {
    // Sanity floors: these guard against the walk silently resolving to an
    // empty/wrong directory (which would make every assertion vacuously pass).
    expect(routes.length).toBeGreaterThan(50);
    expect(fetchPaths.length).toBeGreaterThan(20);
  });

  it("every browser /api/dashboard/ fetch has an existing proxy route", () => {
    const unmatched = fetchPaths
      .filter(({ prefix }) => !KNOWN_PENDING_PROXIES.has(prefix))
      .filter(({ prefix }) => !hasMatchingRoute(prefix.split("/"), routes));

    expect(
      unmatched,
      `Browser code fetches /api/dashboard/<path> with no matching Next proxy route ` +
        `(missing app/api/dashboard/.../route.ts -> live 404). Add the proxy route ` +
        `(+ the server api-client method it forwards to), or — if this is intentional, ` +
        `in-progress work — add the static-prefix to KNOWN_PENDING_PROXIES with a reason.\n` +
        unmatched.map((u) => `  - "${u.prefix}"  (first seen in ${u.source})`).join("\n"),
    ).toEqual([]);
  });

  it("keeps the pending-proxy allowlist minimal (no stale entries)", () => {
    const referenced = new Set(fetchPaths.map((f) => f.prefix));
    const stale = [...KNOWN_PENDING_PROXIES].filter((entry) => !referenced.has(entry));
    expect(
      stale,
      `KNOWN_PENDING_PROXIES has entries no browser file references anymore — ` +
        `remove them (the gap they covered is gone):\n` +
        stale.map((e) => `  - "${e}"`).join("\n"),
    ).toEqual([]);
  });
});
