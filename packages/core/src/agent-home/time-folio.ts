import { computeWindowStart } from "./window.js";

/**
 * Renders an `occurredAt` timestamp as a display-ready string relative to `now`
 * in the given IANA timezone.
 *
 * - Same day   →  "11:42 AM"
 * - Yesterday  →  "Yesterday · 6:14 PM"
 * - This week  →  "Mon · 9:00 AM"
 * - Older      →  "May 3 · 11:42 AM"
 */
export function formatTimeFolio(occurredAt: Date, now: Date, timezone: string): string {
  const time = formatHM(occurredAt, timezone);
  const todayStart = computeWindowStart("today", now, timezone);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = computeWindowStart("week", now, timezone);

  if (occurredAt.getTime() >= todayStart.getTime()) return time;
  if (occurredAt.getTime() >= yesterdayStart.getTime()) return `Yesterday · ${time}`;
  if (occurredAt.getTime() >= weekStart.getTime()) {
    const wd = shortWeekday(occurredAt, timezone);
    return `${wd} · ${time}`;
  }
  return `${shortMonthDay(occurredAt, timezone)} · ${time}`;
}

function formatHM(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Intl emits a non-breaking space (U+00A0) or narrow no-break space (U+202F)
  // between the time and AM/PM on some Node versions. Normalize to a regular space.
  return fmt.format(d).replace(/[\u00a0\u202f]/g, " ");
}

function shortWeekday(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  return fmt.format(d); // "Mon"
}

function shortMonthDay(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
  return fmt.format(d); // "May 3"
}
