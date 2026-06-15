import type { ExceptionCode } from "@switchboard/schemas";
import type { SerializedExceptionEntry } from "./build-receipted-booking-data.js";

/**
 * Append-only, history-preserving reconcile of a persisted exceptions array against a freshly-computed
 * DESIRED set, scoped to the codes this write OWNS (`governedCodes`). Pure and JSON-native (ISO-string
 * dates, never Date), so the resulting payload cannot raise a Prisma Json error. Reused by every array
 * WRITE on the reconcile path (flag_duplicate / resolve_exception).
 *
 * Rules (spec 2026-06-15, "Exceptions merge semantics"):
 * - For each code in `governedCodes`:
 *   - desired AND prior has an OPEN entry -> keep the prior open entry untouched (preserve raisedAt + detail).
 *   - desired AND no prior open entry -> append `{ code, detail?, raisedAt: now, resolvedAt: null }` (re-raise;
 *     any prior resolved entry stays as history). The detail is taken from the desired entry.
 *   - prior OPEN AND not desired -> stamp `resolvedAt: now` on the prior open entry.
 * - Codes outside `governedCodes`, and all prior RESOLVED entries, pass through verbatim (a flag write
 *   must not resolve an unrelated open missing_consent).
 * - Invariant: at most one OPEN entry per code.
 */
export function mergeExceptions(
  prior: SerializedExceptionEntry[],
  desired: SerializedExceptionEntry[],
  now: Date,
  governedCodes: Set<ExceptionCode>,
): SerializedExceptionEntry[] {
  const nowIso = now.toISOString();
  // The governed codes still DESIRED open, mapped to their desired entry (for the detail on append).
  const desiredOpen = new Map<ExceptionCode, SerializedExceptionEntry>();
  for (const entry of desired) {
    if (governedCodes.has(entry.code) && entry.resolvedAt == null) {
      desiredOpen.set(entry.code, entry);
    }
  }

  const result: SerializedExceptionEntry[] = [];
  for (const entry of prior) {
    const open = entry.resolvedAt == null;
    if (governedCodes.has(entry.code) && open) {
      if (desiredOpen.has(entry.code)) {
        // Still desired-open: keep the prior open entry untouched (preserve its raisedAt + detail).
        result.push(entry);
        desiredOpen.delete(entry.code);
      } else {
        // No longer desired: stamp resolvedAt.
        result.push({ ...entry, resolvedAt: nowIso });
      }
    } else {
      // Non-governed code, or already-resolved history: carried forward verbatim.
      result.push(entry);
    }
  }
  // Governed codes desired-open with no prior open entry: append fresh.
  for (const [code, entry] of desiredOpen) {
    result.push({
      code,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      raisedAt: nowIso,
      resolvedAt: null,
    });
  }
  return result;
}
