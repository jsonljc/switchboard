// Pure local-date <-> instant conversion at the org-timezone edge (Riley v3
// slice 4b). The 4a substrate stores ISO-8601 instants; operators think in
// inclusive local dates ("promo June 1-15"). Day-boundary rule, pinned by
// tests: start = 00:00:00.000 of the start date in the org timezone; end =
// 00:00:00.000 of the day AFTER the inclusive end date, producing a half-open
// [start, end) interval that covers the whole final local day with no
// 23:59:59 gap. No date library: Intl.DateTimeFormat only.

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_TZ = "Asia/Singapore";

/**
 * Org timezone with the same fallback the alex builder uses. An invalid
 * stored timezone string (free-text BusinessFacts field) degrades to the
 * fallback instead of crashing the editor.
 */
export function ensureTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

/** Offset of `timeZone` from UTC at the given instant, in ms (second precision). */
function tzOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instantMs);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Convert an operator-local INCLUSIVE date to an ISO-8601 instant in the org
 * timezone. boundary "start" = local midnight of that date; boundary "end" =
 * local midnight of the NEXT day (half-open interval; see module note).
 * Two-pass offset refinement converges across DST transitions.
 */
export function localDateToInstant(
  date: string,
  timeZone: string,
  boundary: "start" | "end",
): string {
  if (!LOCAL_DATE_RE.test(date)) throw new Error(`invalid local date: ${date}`);
  // Harden at the lowest layer: an invalid zone degrades to the fallback here
  // too, so a non-section caller cannot crash on a malformed BusinessFacts
  // timezone.
  const tz = ensureTimeZone(timeZone);
  const [y, m, d] = date.split("-").map(Number);
  const dayUtcMidnight = Date.UTC(
    y as number,
    (m as number) - 1,
    (d as number) + (boundary === "end" ? 1 : 0),
  );
  let offset = tzOffsetMs(dayUtcMidnight, tz);
  let instant = dayUtcMidnight - offset;
  offset = tzOffsetMs(instant, tz);
  instant = dayUtcMidnight - offset;
  return new Date(instant).toISOString();
}

/** Local calendar date (YYYY-MM-DD) of an instant in the org timezone. */
export function instantToLocalDate(iso: string, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD. Same lowest-layer hardening as
  // localDateToInstant: invalid zones degrade to the fallback.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ensureTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Recover the operator-facing INCLUSIVE end date from an exclusive end
 * instant: the instant 1ms earlier falls inside the last covered local day.
 */
export function instantToInclusiveEndDate(iso: string, timeZone: string): string {
  return instantToLocalDate(new Date(Date.parse(iso) - 1).toISOString(), timeZone);
}
