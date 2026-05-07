import { computeWindowStart } from "./window.js";

/**
 * Renders an `occurredAt` timestamp as a short relative-age string suitable
 * for pipeline-tile ctx lines.
 *
 * - future dates           →  "just now" (defensive against clock skew)
 * - < 1 minute             →  "just now"
 * - < 1 hour               →  "5m ago"
 * - same calendar day      →  "3h ago"
 * - previous calendar day  →  "yesterday"
 * - within trailing 7d     →  "3d ago"
 * - earlier same month     →  "12d ago"
 * - earlier than month     →  "Mar 3"
 *
 * Calendar boundaries computed via computeWindowStart (mirrors formatTimeFolio).
 */
export function formatRelativeAge(occurredAt: Date, now: Date, timezone: string): string {
  const deltaMs = now.getTime() - occurredAt.getTime();
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;

  const todayStart = computeWindowStart("today", now, timezone);
  if (occurredAt.getTime() >= todayStart.getTime()) {
    return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  }

  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  if (occurredAt.getTime() >= yesterdayStart.getTime()) return "yesterday";

  const weekStart = computeWindowStart("week", now, timezone);
  if (occurredAt.getTime() >= weekStart.getTime()) {
    const days = Math.floor(deltaMs / 86_400_000);
    return `${days}d ago`;
  }

  // Trailing 30-day window for the month branch — NOT computeWindowStart("month",...)
  // which returns the calendar-month 1st. Calendar-aligned semantics would create
  // a gap (e.g., April 25 from May 7 would fall through to "Apr 25" instead of
  // "12d ago"). Pipeline ctx wants smooth "Nd ago" up to ~30d, then a date.
  const monthStart = new Date(todayStart.getTime() - 30 * 86_400_000);
  if (occurredAt.getTime() >= monthStart.getTime()) {
    const days = Math.floor(deltaMs / 86_400_000);
    return `${days}d ago`;
  }

  return shortMonthDay(occurredAt, timezone);
}

function shortMonthDay(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
  return fmt.format(d); // "May 3"
}
