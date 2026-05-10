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

/** Resolve the display timezone: org tz → browser tz → UTC. */
export function resolveTimezone(orgTimezone: string | null | undefined): string {
  if (orgTimezone && orgTimezone.length > 0) return orgTimezone;
  return browserTimezone();
}

/**
 * Short month-day for the table cell. Falls back to "—" if the upstream
 * delivers a malformed timestamp (Zod should have caught it earlier; this
 * is a defensive last resort so a bad row doesn't crash the whole table).
 */
export function formatShortDate(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Full ISO8601 with offset, used inside the drawer. */
export function formatFullIso(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Build the offset for the target zone using Intl, then format manually.
  // Avoids pulling in date-fns-tz just for this surface.
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "shortOffset",
    }).formatToParts(d);
    const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const datePart = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
    const timePart = `${lookup("hour")}:${lookup("minute")}:${lookup("second")}`;
    // shortOffset returns e.g. "GMT+8" — normalise to "+08:00".
    const offsetRaw = lookup("timeZoneName").replace("GMT", "");
    const sign = offsetRaw.startsWith("-") ? "-" : "+";
    const num = offsetRaw.replace(/[+-]/, "");
    const [h, m = "0"] = num.split(":");
    const offset = `${sign}${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    return `${datePart}T${timePart}${offset}`;
  } catch {
    return d.toISOString();
  }
}

export function truncateWorkflowId(id: string | null): string {
  if (!id) return "—";
  return `WF:${id.slice(0, 8)}`;
}

export function redactedKeyLabel(count: number): string {
  if (count <= 0) return "";
  return ` · ${count} redacted`;
}
