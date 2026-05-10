/**
 * Format helpers for the /activity Mercury surface.
 *
 * Org-tz → browser-tz → UTC fallback chain mirrors contacts/format.ts.
 * New helpers: formatCell, formatDrawer, truncate, hashPrefix.
 */

const FALLBACK_TZ = "UTC";

function browserTimezone(): string {
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

/**
 * Resolve the timezone to use for display.
 * Falls back: org-tz (when provided) → browser-tz → UTC.
 */
function resolveTimezone(orgTimezone?: string): string {
  if (orgTimezone) return orgTimezone;
  return browserTimezone();
}

/**
 * Format an ISO8601 timestamp for the Mercury list cell.
 * Falls back: org-tz (when available) → browser-tz → UTC.
 *
 * Renders as a short date+time: "May 10, 2026, 14:23" in the resolved tz.
 * Defensive against bad input — returns "—" for invalid timestamps.
 */
export function formatCell(iso: string, orgTimezone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tz = resolveTimezone(orgTimezone);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    // Unknown tz string — degrade to UTC
    return new Intl.DateTimeFormat("en-US", {
      timeZone: FALLBACK_TZ,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }
}

/**
 * Format an ISO8601 timestamp for the drawer (full ISO with offset).
 * Always shows the full ISO string plus the resolved timezone abbreviation,
 * e.g. "2026-05-10T14:23:51.420Z (UTC)" or "2026-05-10T14:23:51.420Z (PDT)".
 *
 * Defensive against bad input — returns "—" for invalid timestamps.
 */
export function formatDrawer(iso: string, orgTimezone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tz = resolveTimezone(orgTimezone);

  let tzAbbr: string;
  try {
    // Extract timezone abbreviation using a timeZoneName: "short" formatter
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(d);
    tzAbbr = parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    tzAbbr = FALLBACK_TZ;
  }

  return `${d.toISOString()} (${tzAbbr})`;
}

/**
 * Truncate a string to a mono-prefix display.
 * - `truncate("agent_alex_001", 8)` → "agent_al"
 * - `truncate(short, n)` where short.length <= n → short unchanged
 */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n);
}

/**
 * Mono-prefix display for a hash. Returns "HASH:abcd1234" form (8-char prefix
 * after the HASH: label). The full hash is always available separately for
 * copy-to-clipboard.
 *
 * - `hashPrefix("abc...64chars...")` → "HASH:abcd1234"
 * - `hashPrefix("")` → "HASH:"
 */
export function hashPrefix(h: string): string {
  return `HASH:${h.slice(0, 8)}`;
}
