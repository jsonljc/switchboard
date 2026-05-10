import { formatRelativeAge } from "@switchboard/core";
import type { ContactBrowseRow } from "@switchboard/schemas";

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

/** Renders an ISO timestamp as the same short relative string the agent-home
 *  pipeline tiles use. `now` is injectable for deterministic tests.
 *
 *  Defensive against bad input — if the upstream ever delivers a malformed or
 *  null timestamp (the schema rejects this, but a hot-fix could route around
 *  it), fall back to "—" rather than rendering literal "Invalid Date". */
export function relativeAge(iso: string, now: Date = new Date(), timezone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatRelativeAge(d, now, timezone ?? browserTimezone());
}

const STAGE_LABELS: Record<ContactBrowseRow["stage"], string> = {
  new: "New",
  active: "Active",
  customer: "Customer",
  retained: "Retained",
  dormant: "Dormant",
};
export function stageLabel(stage: ContactBrowseRow["stage"]): string {
  return STAGE_LABELS[stage];
}

const CHANNEL_LABELS: Record<ContactBrowseRow["primaryChannel"], string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  dashboard: "Dashboard",
};
export function channelLabel(channel: ContactBrowseRow["primaryChannel"]): string {
  return CHANNEL_LABELS[channel];
}
