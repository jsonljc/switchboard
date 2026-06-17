import type { ExceptionCode, ExceptionEntry } from "@switchboard/schemas";
import type { SerializedExceptionEntry } from "./build-receipted-booking-data.js";

/**
 * Assemble the final exceptions array for the view: live-recomputed entries (recomputable codes
 * like missing_source, missing_consent, manual_override) UNION the OPEN persisted entries for codes
 * the live recompute does not own (array-sourced codes like duplicate_contact_risk).
 *
 * A code present in `recomputable` wins; the persisted entry for the same code is dropped to
 * avoid double-counting and preserve the one-open-per-code invariant. Persisted entries are
 * date-hydrated (ISO strings -> Date) to satisfy ExceptionEntry.raisedAt: z.date().
 *
 * `suppressPersistedCodes` drops a persisted entry for a code that the CURRENT facts say is no
 * longer applicable but that the live recompute does NOT emit (so it would otherwise carry forward
 * stale). The motivating case: a booking issued before the jurisdiction fix persisted a
 * missing_consent for a now-null-jurisdiction contact; the live recompute omits missing_consent
 * (consent not_applicable), so without suppression the stale persisted one would still surface.
 * The caller passes the suppression set ONLY when the current facts make the code inapplicable
 * (e.g. jurisdiction === null -> suppress "missing_consent"); a legitimate missing_consent for a
 * non-null jurisdiction is never suppressed because the caller never adds it to the set.
 *
 * Pure function; no side effects. Spec: 2026-06-15-receipted-booking-override.md, getView step 5.
 */
export function assembleViewExceptions(
  recomputable: ExceptionEntry[],
  persisted: SerializedExceptionEntry[],
  suppressPersistedCodes: ReadonlySet<ExceptionCode> = new Set(),
): ExceptionEntry[] {
  const recomputableCodes = new Set(recomputable.map((e) => e.code));
  const carried: ExceptionEntry[] = persisted
    .filter(
      (e) => !e.resolvedAt && !recomputableCodes.has(e.code) && !suppressPersistedCodes.has(e.code),
    )
    .map((e) => ({
      code: e.code,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
      raisedAt: new Date(e.raisedAt),
      resolvedAt: null,
    }));
  return [...recomputable, ...carried];
}
