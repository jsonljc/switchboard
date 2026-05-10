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

export function resolveTimezone(orgTimezone: string | null | undefined): string {
  if (orgTimezone && orgTimezone.length > 0) return orgTimezone;
  return browserTimezone();
}

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

export function formatFullIso(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
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
