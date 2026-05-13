/**
 * Format helpers for the /activity Mercury surface.
 *
 * Org-tz → browser-tz → UTC fallback chain mirrors contacts/format.ts.
 * New helpers: formatCell, formatDrawer, truncate, hashPrefix.
 */

import { browserTimezone } from "@/lib/format/browser-timezone";

const FALLBACK_TZ = "UTC";

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

// ---------------------------------------------------------------------------
// v2 helpers (table row + drawer)
// ---------------------------------------------------------------------------

/**
 * Mono clock for the v2 row's TIME column — "HH:MM:SS" in the resolved tz.
 * Defensive against bad input; returns "—" rather than throwing.
 */
export function fmtClock(iso: string, orgTimezone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tz = resolveTimezone(orgTimezone);
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: FALLBACK_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  }
}

/**
 * Relative-time display — "Xs / Xm / Xh / Xd ago". Negative deltas clamp to 0s.
 * The caller computes `Date.now() - new Date(row.timestamp).getTime()` and
 * passes the result in.
 */
export function fmtRel(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hrs = Math.floor(minutes / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Drawer full-ISO breakdown. Returns the three parts the drawer renders
 * separately: `{date}-{date} · {time} {tz}`.
 * Defensive against bad input; returns dashes rather than throwing.
 */
export function fmtFullISO(
  iso: string,
  orgTimezone?: string,
): { date: string; time: string; tz: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—", tz: "" };
  const tz = resolveTimezone(orgTimezone);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "longOffset",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    const time = `${get("hour")}:${get("minute")}:${get("second")}.${ms}`;
    // longOffset emits "GMT+08:00"; strip the "GMT" prefix.
    const offset = get("timeZoneName").replace(/^GMT/, "") || "+00:00";
    return { date, time, tz: offset };
  } catch {
    return { date: "—", time: "—", tz: "" };
  }
}

/**
 * Event-band classifier — collapses the 45 event types into 4 bands for the
 * dot-color in the v2 row's event-type badge. Bands match the locked design's
 * combobox grouping.
 */
export function eventBand(eventType: string): "action" | "identity" | "event" | "agent" {
  if (eventType.startsWith("action.")) return "action";
  if (eventType.startsWith("event.")) return "event";
  if (eventType.startsWith("agent.") || eventType.startsWith("work_trace.")) {
    return "agent";
  }
  return "identity";
}
