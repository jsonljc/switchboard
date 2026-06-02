/**
 * Render an appointment's date + time for the WhatsApp reminder template, in the
 * clinic's timezone. `date` -> "13 May 2026"; `time` -> "10:00 AM". A wrong-tz
 * reminder is worse than none, so the timezone is always explicit.
 */
export function formatReminderDateTime(
  startsAt: Date,
  timezone: string,
): { date: string; time: string } {
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Normalize U+00A0 (non-breaking space) and U+202F (narrow no-break space)
  // that Intl inserts before AM/PM, replacing with a regular space.
  const norm = (s: string): string => s.replace(/[\u00a0\u202f]/g, " ");
  return { date: norm(dateFmt.format(startsAt)), time: norm(timeFmt.format(startsAt)) };
}
