// apps/dashboard/src/lib/data-mode/shared.ts
//
// Pure data-mode resolver + production-safety guard.
// Safe to import from any context (server, client, tests).
// See docs/superpowers/specs/2026-05-16-dashboard-demo-data-toggle-design.md

export type DataMode = "demo" | "live";

export const DATA_MODE_COOKIE = "sw.data-mode";

type DataModeEnv = {
  ALLOW_FIXTURE_DATA_MODE?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
};

/**
 * Pure resolver: cookie value + env → DataMode.
 * - Invalid, missing, or unknown cookie values resolve to "live".
 * - When fixture mode is not allowed (production), always returns "live"
 *   regardless of cookie state.
 */
export function resolveDataMode(rawCookieValue: string | undefined, env: DataModeEnv): DataMode {
  if (!isFixtureModeAllowed(env)) return "live";
  return rawCookieValue === "demo" ? "demo" : "live";
}

/**
 * Guard chain. Hard-denies real production BEFORE honoring any explicit
 * opt-in, so a misconfigured ALLOW_FIXTURE_DATA_MODE on a Vercel production
 * deployment cannot expose demo data. The ordering is load-bearing.
 */
export function isFixtureModeAllowed(env: DataModeEnv): boolean {
  if (env.VERCEL_ENV === "production") return false;
  if (env.ALLOW_FIXTURE_DATA_MODE === "true") return true;
  if (env.NODE_ENV === "production") return false;
  return true;
}
