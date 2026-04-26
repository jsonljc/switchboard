import type { SourceFunnel } from "../crm-data-provider/real-provider.js";

/**
 * Per-source comparison row. Any metric that would require a zero-denominator
 * is reported as `null` (not 0) so downstream consumers can distinguish
 * "no data" from "literal zero".
 *
 * Note: `closeRate` is `paid / received` (NOT `paid / showed`). Per Task 12,
 * `SourceFunnel.showed` is always 0 in v1 — any rate involving `showed` would
 * be uninformative.
 */
export interface SourceComparisonRow {
  source: string;
  cpl: number | null;
  costPerQualified: number | null;
  costPerBooked: number | null;
  closeRate: number | null;
  trueRoas: number | null;
}

export interface SourceComparisonInput {
  bySource: Record<string, SourceFunnel>;
  spendBySource: Record<string, number>;
}

export interface SourceComparisonResult {
  rows: SourceComparisonRow[];
}

const safeDiv = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/**
 * Pure cross-source analyzer. Given per-source funnel counts and per-source
 * spend, computes side-by-side CPL / cost-per-qualified / cost-per-booked /
 * close rate / true ROAS so the weekly audit can compare CTWA vs Instant
 * Form (and future sources) on equal footing.
 */
export function compareSources(input: SourceComparisonInput): SourceComparisonResult {
  const rows: SourceComparisonRow[] = [];
  for (const [source, funnel] of Object.entries(input.bySource)) {
    const spend = input.spendBySource[source] ?? 0;
    rows.push({
      source,
      cpl: safeDiv(spend, funnel.received),
      costPerQualified: safeDiv(spend, funnel.qualified),
      costPerBooked: safeDiv(spend, funnel.booked),
      closeRate: safeDiv(funnel.paid, funnel.received),
      trueRoas: safeDiv(funnel.revenue, spend),
    });
  }
  return { rows };
}
