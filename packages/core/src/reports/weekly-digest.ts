import { AttributionConfidenceSchema } from "@switchboard/schemas";
import type {
  AttributionConfidence,
  ExceptionCode,
  ReceiptedBookingWorklistItem,
  ReportDataV1,
  WeeklyDigest,
  WeeklyDigestAttentionItem,
  WeeklyDigestMetric,
} from "@switchboard/schemas";

/**
 * Turn an assembled ReportDataV1 into the owner-facing WeeklyDigest content model. Pure and
 * deterministic: every figure is formatted here and NaN-safe (rates that are null render an honest
 * phrase, non-finite money guards to zero), so the delivery layer renders display-ready strings and
 * can never leak a raw NaN. Reads the receipted-bookings, revenue, quality, held-rate, and
 * consent-completeness fields, plus the Riley ad-economics (attribution.riley, campaigns) so the
 * weekly artifact reflects the full cross-agent loop: Riley feeds paid demand, Alex books it.
 */

export interface BuildWeeklyDigestOptions {
  /** Display-ready label for the period the digest covers, e.g. "Jun 9 to Jun 15". */
  periodLabel: string;
  /** Absolute URL to the full dashboard report. */
  dashboardUrl: string;
  /** Max worklist items to include in the digest body; default 5. */
  maxAttentionItems?: number;
}

const DEFAULT_MAX_ATTENTION_ITEMS = 5;

const EXCEPTION_LABELS: Record<ExceptionCode, string> = {
  missing_source: "missing source",
  missing_consent: "missing consent",
  manual_override: "manual override",
  duplicate_contact_risk: "possible duplicate",
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function formatMoneyFromCents(cents: number, currency: string | null): string {
  const safeCents = Number.isFinite(cents) ? cents : 0;
  const major = safeCents / 100;
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(major);
    } catch {
      return `${major.toFixed(2)} ${currency}`;
    }
  }
  return `$${major.toFixed(2)}`;
}

function formatPercent(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return `${Math.round(rate * 100)}%`;
}

/** Format a MAJOR-unit money figure (the report's ad/attribution numbers are dollars, not cents).
 *  Non-finite input guards to $0.00 so the digest can never render NaN. Grouped with two decimals to
 *  match the receipt-revenue style ("$3,450.00"). */
function formatMoneyMajor(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Sum a major-unit numeric field across campaigns, skipping non-finite entries so a single bad
 *  insights row can never poison the total into NaN. */
function sumFinite(values: number[]): number {
  let total = 0;
  for (const v of values) {
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

/** Blended return on ad spend = total campaign revenue / total campaign spend, e.g. "3.0x".
 *  Returns null when there is no finite, positive spend so the consumer renders an honest phrase
 *  instead of a NaN or Infinity ratio. */
function formatRoas(revenue: number, spend: number): string | null {
  if (!Number.isFinite(spend) || spend <= 0) return null;
  const safeRevenue = Number.isFinite(revenue) ? revenue : 0;
  return `${(safeRevenue / spend).toFixed(1)}x`;
}

function formatDayUTC(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return DAY_FORMAT.format(date);
}

function confidenceBreakdown(confidence: Record<AttributionConfidence, number>): string {
  const parts = AttributionConfidenceSchema.options
    .filter((rung) => (confidence[rung] ?? 0) > 0)
    .map((rung) => `${confidence[rung]} ${rung}`);
  return parts.length > 0 ? parts.join(", ") : "no data yet";
}

function mapAttentionItem(item: ReceiptedBookingWorklistItem): WeeklyDigestAttentionItem {
  const issues = item.openExceptionCodes.map((code) => EXCEPTION_LABELS[code] ?? code).join(", ");
  return {
    service: item.service,
    when: formatDayUTC(item.startsAt),
    confidence: item.attributionConfidence,
    issues: issues.length > 0 ? issues : "needs review",
  };
}

function buildSubject(count: number, revenueCents: number, money: string): string {
  if (count <= 0) return "Your week: no receipted bookings yet";
  const noun = count === 1 ? "receipted booking" : "receipted bookings";
  const base = `Your week: ${count} ${noun}`;
  return Number.isFinite(revenueCents) && revenueCents > 0 ? `${base}, ${money} booked` : base;
}

function buildAttentionNote(shown: number, total: number): string | null {
  if (total <= 0) return null;
  if (shown > 0 && shown < total)
    return `Showing first ${shown} of ${total} bookings that need attention.`;
  return total === 1 ? "1 booking needs attention." : `${total} bookings need attention.`;
}

export function buildWeeklyDigest(
  report: ReportDataV1,
  opts: BuildWeeklyDigestOptions,
): WeeklyDigest {
  const {
    receiptedBookings,
    receiptedBookingRevenue,
    receiptedBookingQuality,
    heldRate,
    consentCompleteness,
    attribution,
    campaigns,
  } = report;
  const count = receiptedBookings.count;
  const money = formatMoneyFromCents(
    receiptedBookingRevenue.revenueCents,
    receiptedBookingRevenue.currency,
  );

  // Riley ad-economics: surfaced from the already-assembled ad-insights fields so the weekly
  // artifact reflects the cross-agent loop (Riley feeds paid demand; Alex books it). Major-unit
  // money, NaN-safe. Blended ROAS uses campaign revenue/spend so the ratio is internally consistent.
  const campaignCount = campaigns.length;
  const adSpend = sumFinite(campaigns.map((c) => c.spend));
  const campaignRevenue = sumFinite(campaigns.map((c) => c.revenue));
  const roas = formatRoas(campaignRevenue, adSpend);

  const metrics: WeeklyDigestMetric[] = [
    { key: "receipted_bookings", label: "Receipted bookings", value: String(count) },
    {
      key: "receipted_revenue",
      label: "Receipted revenue",
      value: money,
      detail: `${receiptedBookingRevenue.bookingsWithValue} of ${receiptedBookingRevenue.cohortSize} carried a value`,
    },
    {
      key: "attribution_quality",
      label: "Attribution quality",
      value: confidenceBreakdown(receiptedBookingQuality.confidence),
    },
    {
      key: "needs_attention",
      label: "Bookings needing attention",
      value: String(receiptedBookingQuality.bookingsNeedingAttention),
    },
    {
      key: "held_rate",
      label: "Held appointment rate",
      value: formatPercent(heldRate.rate) ?? "no matured bookings yet",
      detail: `${heldRate.attended} of ${heldRate.matured} attended`,
    },
    {
      key: "consent_completeness",
      label: "Consent completeness",
      value: formatPercent(consentCompleteness.rate) ?? "no applicable contacts yet",
      detail: `${consentCompleteness.validConsent} of ${consentCompleteness.bookable} with valid consent`,
    },
    {
      key: "riley_attributed_revenue",
      label: "Riley attributed revenue",
      value: formatMoneyMajor(attribution.riley.value),
      detail: attribution.riley.caption,
    },
    {
      key: "ad_spend",
      label: "Ad spend",
      value: formatMoneyMajor(adSpend),
      detail:
        campaignCount > 0
          ? `${campaignCount} campaign${campaignCount === 1 ? "" : "s"}`
          : "no campaigns yet",
    },
    {
      key: "roas",
      label: "Return on ad spend",
      value: roas ?? "no ad spend yet",
      ...(roas
        ? { detail: `${formatMoneyMajor(campaignRevenue)} from ${formatMoneyMajor(adSpend)} spent` }
        : {}),
    },
  ];

  const maxItems = opts.maxAttentionItems ?? DEFAULT_MAX_ATTENTION_ITEMS;
  const attention = receiptedBookingQuality.worklist.slice(0, maxItems).map(mapAttentionItem);
  const attentionNote = buildAttentionNote(
    attention.length,
    receiptedBookingQuality.bookingsNeedingAttention,
  );

  return {
    subject: buildSubject(count, receiptedBookingRevenue.revenueCents, money),
    headline: `Here is your receipted-bookings summary for ${opts.periodLabel}.`,
    periodLabel: opts.periodLabel,
    metrics,
    attention,
    attentionNote,
    dashboardUrl: opts.dashboardUrl,
  };
}

/** Render a WeeklyDigest as a plain-text email body. Display-ready; performs no math. */
export function renderWeeklyDigestText(digest: WeeklyDigest): string {
  const lines: string[] = [digest.headline, ""];
  for (const metric of digest.metrics) {
    lines.push(`${metric.label}: ${metric.value}`);
    if (metric.detail) lines.push(`  (${metric.detail})`);
  }
  if (digest.attention.length > 0) {
    lines.push("", "Bookings needing attention:");
    for (const item of digest.attention) {
      lines.push(`- ${item.service}, ${item.when}: ${item.issues} (${item.confidence})`);
    }
  }
  if (digest.attentionNote) {
    lines.push("", digest.attentionNote);
  }
  lines.push("", `Full report: ${digest.dashboardUrl}`);
  return lines.join("\n");
}
