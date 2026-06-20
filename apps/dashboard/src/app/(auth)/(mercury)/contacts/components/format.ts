// Unit: Opportunity.estimatedValue + .revenueTotal are stored in CENTS.
// Verified 2026-05-14 against packages/core/src/lifecycle/fallback-handler.ts:145
// (which divides by 100 to format as dollars) and packages/db/prisma/schema.prisma:1630-1631
// (Int columns; magnitude of mockup fixtures like 28000=S$280 confirms cents).

import { formatMoney } from "@/lib/money";

/** Formats an integer SGD value (CENTS) as `S$1,234`. Em-dash for null. By
 *  default, also em-dash for zero (typical pipeline display rule). Pass
 *  `forceZero` to render `S$0` explicitly (used by terminal columns).
 *  The whole-dollar rounding and S$ rendering delegate to the canonical money
 *  formatter (#6b); only the cents-to-dollars conversion and the zero rule
 *  live here. Output is unchanged for the non-negative values these revenue and
 *  estimate fields carry. (A negative, which the data never holds, would place
 *  the sign before S$ per the canonical convention.) */
export function formatSGD(value: number | null, opts: { forceZero?: boolean } = {}): string {
  if (value == null) return "—";
  if (value === 0 && !opts.forceZero) return "—";
  return formatMoney(Math.round(value / 100), { withCents: "never" });
}

/** Compact SGD: `S$1.2k` at >= S$10k, full digits otherwise. Returns `null`
 *  for null input so callers can decide between rendering em-dash or hiding.
 *  Kept bespoke (not on the canonical `compact`): the canonical k-form rounds
 *  to whole thousands (S$16.8k would become S$17k), but the pipeline KPI header
 *  wants one-decimal precision, so the compact algorithm stays here. */
export function formatSGDCompact(value: number | null): string | null {
  if (value == null) return null;
  const dollars = value / 100;
  if (dollars >= 10000) {
    const k = dollars / 1000;
    return `S$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `S$${Math.round(dollars).toLocaleString()}`;
}

/** Short relative-age helper with a stable short-form output:
 *  "just now" / "Nm ago" / "Nh ago" / "Nd ago" / "Nmo ago".
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
