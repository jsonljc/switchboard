import { formatRelativeAge } from "@switchboard/core";
import type { ContactBrowseRow } from "@switchboard/schemas";

import { browserTimezone } from "@/lib/format/browser-timezone";

// Unit: Opportunity.estimatedValue + .revenueTotal are stored in CENTS.
// Verified 2026-05-14 against packages/core/src/lifecycle/fallback-handler.ts:145
// (which divides by 100 to format as dollars) and packages/db/prisma/schema.prisma:1630-1631
// (Int columns; magnitude of mockup fixtures like 28000=S$280 confirms cents).

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

/** Formats an integer SGD value as `S$1,234`. Em-dash for null. By default,
 *  also em-dash for zero (typical pipeline display rule). Pass `forceZero`
 *  to render `S$0` explicitly (used by terminal columns). */
export function formatSGD(value: number | null, opts: { forceZero?: boolean } = {}): string {
  if (value == null) return "—";
  if (value === 0 && !opts.forceZero) return "—";
  const dollars = Math.round(value / 100);
  return `S$${dollars.toLocaleString()}`;
}

/** Compact SGD: `S$1.2k` at >= S$10k, full digits otherwise. Returns `null`
 *  for null input so callers can decide between rendering em-dash or hiding. */
export function formatSGDCompact(value: number | null): string | null {
  if (value == null) return null;
  const dollars = value / 100;
  if (dollars >= 10000) {
    const k = dollars / 1000;
    return `S$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `S$${Math.round(dollars).toLocaleString()}`;
}

/** Short relative-age helper, mirroring `relativeAge` but with a stable
 *  short-form output: "just now" / "Nm ago" / "Nh ago" / "Nd ago" / "Nmo ago".
 *  `now` is injectable for deterministic tests. */
export function relTime(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now.getTime() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}
