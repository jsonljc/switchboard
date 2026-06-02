import type { SourceFunnel, CampaignFunnel } from "../crm-data-provider/real-provider.js";
import { normalizeConversionValue } from "../conversion-value.js";

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
      trueRoas: trueRoasFromCents(funnel.revenue, spend),
    });
  }
  return { rows };
}

/**
 * trueROAS from a CENTS value numerator and a MAJOR-unit (dollar) spend
 * denominator. Normalizes cents→major exactly once (the #819 trap). Returns
 * null when the value is unknown (`null`) or spend is non-positive — never a
 * fabricated 0 for "no attributed value".
 */
export function trueRoasFromCents(valueCents: number | null, spend: number): number | null {
  if (valueCents === null || spend <= 0) return null;
  return normalizeConversionValue(valueCents) / spend;
}

/** Per-campaign economics row. Any metric over a zero/unknown input is `null`. */
export interface CampaignEconomicsRow {
  campaignId: string;
  cpl: number | null;
  costPerBooked: number | null; // spend ÷ CRM booked count
  bookedValueCents: number | null; // booked ConversionRecord value; null = no attributed value
  trueRoas: number | null; // normalizeConversionValue(bookedValueCents) ÷ spend
}

export interface CampaignComparisonInput {
  byCampaign: Record<string, CampaignFunnel>;
  spendByCampaign: Record<string, number>; // MAJOR units (dollars)
  bookedValueCentsByCampaign: Map<string, number>; // CENTS; absent key = no attributed value
}

/**
 * Per-campaign booked-CAC + trueROAS, joined from three canonical sources:
 * funnel counts (CRM `booked` count → booked-CAC denominator), spend (Meta,
 * dollars), and booked value (ConversionRecord, cents → trueROAS numerator).
 * Iterates the `byCampaign` (counts) keys, so a campaign with no booked value
 * is preserved as `bookedValueCents: null` / `trueRoas: null` (sparse-row
 * preservation); campaigns present only in the booked-value map are dropped.
 */
export function compareCampaigns(input: CampaignComparisonInput): { rows: CampaignEconomicsRow[] } {
  const rows: CampaignEconomicsRow[] = [];
  for (const [campaignId, funnel] of Object.entries(input.byCampaign)) {
    const spend = input.spendByCampaign[campaignId] ?? 0;
    const bookedValueCents = input.bookedValueCentsByCampaign.get(campaignId) ?? null;
    rows.push({
      campaignId,
      cpl: safeDiv(spend, funnel.received),
      costPerBooked: safeDiv(spend, funnel.booked),
      bookedValueCents,
      trueRoas: trueRoasFromCents(bookedValueCents, spend),
    });
  }
  return { rows };
}
