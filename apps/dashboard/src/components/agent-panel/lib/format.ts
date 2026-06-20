import { formatMoney } from "@/lib/money";

/**
 * Booking revenue (cents, SGD) for the agent panel. Routes number rendering
 * through the canonical money formatter (#6b consolidation) and corrects the
 * symbol to S$. The prior `$` mislabelled SGD booking value as USD.
 *
 * Keeps the legacy precision rule (cents shown iff the amount is not a whole
 * dollar, at every magnitude) so the wins ledger is byte-identical to its
 * pre-#6b output apart from the corrected symbol; the canonical default would
 * round a >= S$1,000 value. Returns null for null so the caller can fall back
 * to "revenue pending" rather than the canonical em-dash.
 */
export function formatCents(cents: number | null): string | null {
  if (cents == null) return null;
  const dollars = cents / 100;
  return formatMoney(dollars, { withCents: Number.isInteger(dollars) ? "never" : "always" });
}

export function relativeTime(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const diffMin = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
