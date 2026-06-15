import type { ExceptionEntry } from "@switchboard/schemas";
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
 * Pure function; no side effects. Spec: 2026-06-15-receipted-booking-override.md, getView step 5.
 */
export function assembleViewExceptions(
  recomputable: ExceptionEntry[],
  persisted: SerializedExceptionEntry[],
): ExceptionEntry[] {
  const recomputableCodes = new Set(recomputable.map((e) => e.code));
  const carried: ExceptionEntry[] = persisted
    .filter((e) => !e.resolvedAt && !recomputableCodes.has(e.code))
    .map((e) => ({
      code: e.code,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
      raisedAt: new Date(e.raisedAt),
      resolvedAt: null,
    }));
  return [...recomputable, ...carried];
}
