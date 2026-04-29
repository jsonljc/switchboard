import { canonicalizeSync } from "../audit/canonical-json.js";
import { sha256 } from "../audit/canonical-hash.js";
import type { WorkTrace } from "./work-trace.js";

export const WORK_TRACE_HASH_VERSION_V1 = 1;
export const WORK_TRACE_HASH_VERSION_V2 = 2;
export const WORK_TRACE_HASH_VERSION_LATEST = WORK_TRACE_HASH_VERSION_V2;

// Backwards-compatible export for callers that still reference the constant.
// Equals the latest version (operator-mutation rows persist at v2).
export const WORK_TRACE_HASH_VERSION = WORK_TRACE_HASH_VERSION_LATEST;

const EXCLUDED_BASE = ["contentHash", "traceVersion", "lockedAt"] as const;

export const WORK_TRACE_HASH_EXCLUDED_FIELDS_V1 = [
  ...EXCLUDED_BASE,
  // v1 rows pre-date these columns; the column DB defaults backfill them, but
  // they were not present when the original hash was computed.
  "ingressPath",
  "hashInputVersion",
] as const satisfies readonly (keyof WorkTrace)[];

export const WORK_TRACE_HASH_EXCLUDED_FIELDS_V2 = [
  ...EXCLUDED_BASE,
  // hashInputVersion is excluded from the v2 input itself (avoids self-reference);
  // its identity is bound into the hash via the `hashVersion` output field below.
  "hashInputVersion",
] as const satisfies readonly (keyof WorkTrace)[];

function excludedFor(hashInputVersion: number): Set<string> {
  if (hashInputVersion === WORK_TRACE_HASH_VERSION_V1) {
    return new Set<string>(WORK_TRACE_HASH_EXCLUDED_FIELDS_V1);
  }
  if (hashInputVersion === WORK_TRACE_HASH_VERSION_V2) {
    return new Set<string>(WORK_TRACE_HASH_EXCLUDED_FIELDS_V2);
  }
  throw new Error(`Unknown WorkTrace hashInputVersion: ${hashInputVersion}`);
}

/**
 * Build the canonical-ready object hashed by computeWorkTraceContentHash.
 * Explicitly omits excluded fields rather than relying on canonicalizeSync's
 * undefined-skip — the exclusion is auditable from this one place.
 *
 * The excluded field set is selected by the row's own `hashInputVersion`:
 *   - v1 (pre-migration rows): excludes ingressPath + hashInputVersion in
 *     addition to the base set, so original contentHash values still verify.
 *   - v2 (new rows): includes ingressPath in the canonical input; excludes
 *     hashInputVersion to avoid self-reference (its value is bound into the
 *     hash via the output `hashVersion` field below).
 *
 * Includes `hashVersion` and `traceVersionForHash` so the hash binds the
 * algorithm version and the row version respectively. `traceVersionForHash`
 * is a separate name so it cannot collide with the WorkTrace.traceVersion
 * field that we're explicitly excluding.
 */
export function buildWorkTraceHashInput(
  trace: WorkTrace,
  traceVersion: number,
): Record<string, unknown> {
  const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
  const excluded = excludedFor(hashInputVersion);
  const out: Record<string, unknown> = {
    hashVersion: hashInputVersion,
    traceVersionForHash: traceVersion,
  };
  for (const [key, value] of Object.entries(trace) as Array<[keyof WorkTrace, unknown]>) {
    if (excluded.has(key as string)) continue;
    out[key as string] = value;
  }
  return out;
}

/**
 * Compute the SHA-256 content hash of a WorkTrace at a given traceVersion.
 * Returns lowercase hex string (the encoding produced by sha256() in
 * packages/core/src/audit/canonical-hash.ts).
 */
export function computeWorkTraceContentHash(trace: WorkTrace, traceVersion: number): string {
  return sha256(canonicalizeSync(buildWorkTraceHashInput(trace, traceVersion)));
}
