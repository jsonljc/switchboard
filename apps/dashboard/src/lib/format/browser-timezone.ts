/**
 * Resolve the user's browser timezone via Intl, falling back to UTC.
 *
 * Shared by the Mercury format helpers (/contacts, /automations, /activity)
 * to avoid three verbatim copies of the same defensive Intl call.
 *
 * Intentionally tiny — does NOT take an org-tz argument or compose a
 * fallback chain. Each caller wraps this with its own `resolveTimezone`
 * if it needs an org-tz preference layered on top.
 */

const FALLBACK_TZ = "UTC";

export function browserTimezone(): string {
  if (typeof Intl !== "undefined") {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) return tz;
    } catch {
      // fall through
    }
  }
  return FALLBACK_TZ;
}
