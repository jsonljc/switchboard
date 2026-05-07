export type WinTimeWindow = "today" | "week" | "month";

/**
 * Returns the absolute timestamp for the start of the requested window in the
 * given IANA timezone. Today = local midnight. Week = Monday 00:00 local.
 * Month = 1st of the month 00:00 local.
 */
export function computeWindowStart(window: WinTimeWindow, now: Date, timezone: string): Date {
  const parts = getDateParts(now, timezone);

  if (window === "today") {
    return localMidnight(parts.year, parts.month, parts.day, timezone);
  }

  if (window === "month") {
    return localMidnight(parts.year, parts.month, 1, timezone);
  }

  // week: walk back to Monday
  // Work in local calendar space to avoid UTC-midnight/DST confusion.
  const dow = parts.weekday; // 1=Mon..7=Sun
  const daysBack = dow === 7 ? 6 : dow - 1;
  // Anchor in absolute time on the current local date; subtract whole days;
  // re-derive local Y/M/D so the second localMidnight call resolves Monday's offset.
  const localStartOfDay = localMidnight(parts.year, parts.month, parts.day, timezone);
  const mondayInstant = new Date(localStartOfDay.getTime() - daysBack * 86_400_000);
  const mondayParts = getDateParts(mondayInstant, timezone);
  return localMidnight(mondayParts.year, mondayParts.month, mondayParts.day, timezone);
}

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 1=Mon..7=Sun
}

function getDateParts(d: Date, timezone: string): DateParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    weekday: weekdayMap[parts["weekday"] as string],
  };
}

/**
 * Returns the UTC instant corresponding to local midnight on (year, month, day)
 * in the given timezone. Single pass suffices because no IANA timezone has
 * back-to-back DST transitions within a calendar day.
 */
function localMidnight(year: number, month: number, day: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMs = utcGuess.getTime() - Date.parse(formatLocalIso(utcGuess, timezone));
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + offsetMs);
}

function formatLocalIso(d: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}Z`;
}
