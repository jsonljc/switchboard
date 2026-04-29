import { canonicalizeSync } from "../audit/canonical-json.js";
import { sha256 } from "../audit/canonical-hash.js";
import type { WorkTrace } from "./work-trace.js";

export const WORK_TRACE_HASH_VERSION = 1;

export const WORK_TRACE_HASH_EXCLUDED_FIELDS = [
  "contentHash",
  "traceVersion",
  "lockedAt",
] as const satisfies readonly (keyof WorkTrace)[];

const EXCLUDED = new Set<string>(WORK_TRACE_HASH_EXCLUDED_FIELDS);

/**
 * Build the canonical-ready object hashed by computeWorkTraceContentHash.
 * Explicitly omits excluded fields rather than relying on canonicalizeSync's
 * undefined-skip — the exclusion is auditable from this one place.
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
  const out: Record<string, unknown> = {
    hashVersion: WORK_TRACE_HASH_VERSION,
    traceVersionForHash: traceVersion,
  };
  for (const [key, value] of Object.entries(trace) as Array<[keyof WorkTrace, unknown]>) {
    if (EXCLUDED.has(key as string)) continue;
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
