/**
 * /reports backend v1 — locked view-model.
 *
 * Single source of truth for the shape of ReportDataV1, consumed by the
 * dashboard /reports page and produced by core's period-rollup.
 *
 * v1 invariants:
 *   - 3 windows: THIS WEEK, THIS MONTH, THIS QUARTER (spaces, not
 *     underscores — preserved for back-compat with the static page).
 *   - Funnel has 6 stages; "Landing visits" may be hidden client-side
 *     when no pixel data exists, but the row stays in the array.
 *   - managedComparison is null when neither in-period cohort nor
 *     baseline data exists.
 */

import type { AttributionConfidence, ExceptionCode } from "../receipted-booking.js";

export type ReportWindow = "THIS WEEK" | "THIS MONTH" | "THIS QUARTER";

export const REPORT_WINDOWS: readonly ReportWindow[] = [
  "THIS WEEK",
  "THIS MONTH",
  "THIS QUARTER",
] as const;

export const DEFAULT_REPORT_WINDOW: ReportWindow = "THIS MONTH";

export type DeltaKind = "pos" | "flat" | "neg";

export interface Delta {
  kind: DeltaKind;
  text: string;
}

export interface PullQuoteCopy {
  pre: string;
  value: string;
  mid: string;
  cost: string;
  post: string;
}

export interface AttributionCell {
  value: number;
  caption: string;
}

export interface AttributionData {
  total: number;
  delta: Delta;
  riley: AttributionCell;
  alex: AttributionCell;
}

export interface FunnelRowData {
  stage: string;
  n: number;
  label: string;
  delta: Delta | null;
}

export interface FunnelNarrative {
  marker: string;
  text: string;
}

export interface CampaignRow {
  name: string;
  spend: number;
  impressions: number;
  inlineLinkClicks: number;
  costPerInlineLinkClick: number;
  inlineLinkClickCtr: number;
  leads: number;
  revenue: number;
  cpl: number | null;
  clickToLeadRate: number | null;
  roas: number;
}

/**
 * How a paid visit was tied to its campaign (1A-6, honest labeling per spec §11).
 * - ctwa_captured: the booking's ConversionRecord carried a non-null sourceCampaignId
 *   (the click-to-WhatsApp attribution survived the unified Contact).
 * - campaign_missing: no campaign was captured for this booking — render honestly,
 *   never as attributed.
 * - copied_from_contact: reserved for the later contact-fallback path (not emitted
 *   by the 1A-6 read query; cryptographic ClickEvidence is a later spec).
 */
export type AttributionBasis = "ctwa_captured" | "campaign_missing" | "copied_from_contact";

/**
 * One individually-verified PAID visit attributed to the ad that produced it.
 * `amountMajor` is in MAJOR currency units (dollars) — the API converts the
 * stored cents EXACTLY ONCE. This is a per-receipt row, never an aggregate.
 */
export interface PaidVisitRow {
  bookingId: string;
  amountMajor: number;
  currency: string;
  campaignId: string | null;
  campaignName: string | null;
  attributionBasis: AttributionBasis;
  paidAt: string;
}

export interface ReportCampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  inlineLinkClicks: number;
  costPerInlineLinkClick: number;
  inlineLinkClickCtr: number;
  conversions: number;
}

export interface CostBreakdown {
  paid: number;
  alt: number;
  saving: number;
}

export interface ManagedComparisonMetrics {
  spend: number;
  revenue?: number;
  roas?: number;
  replies?: number;
  conversionRate?: number;
  replyMinutesP50?: number;
}

export interface ManagedComparisonPair {
  managed: ManagedComparisonMetrics;
  unmanaged: ManagedComparisonMetrics;
  delta: Delta;
}

export type ManagedComparisonSource = "in-period-cohort" | "pre-switchboard-baseline";

export interface ManagedComparisonData {
  ads: ManagedComparisonPair | null;
  conversations: ManagedComparisonPair | null;
  source: ManagedComparisonSource;
  emptyMessage?: string;
}

export interface HeldRateData {
  attended: number;
  matured: number;
  /** null = no matured bookings in the window (render "no data", never NaN). */
  rate: number | null;
}

export interface ConsentCompletenessData {
  validConsent: number;
  bookable: number;
  /** null = no PDPA-applicable (jurisdiction-tagged) contacts (render "no data", never NaN). */
  rate: number | null;
}

export interface ReceiptedBookingsData {
  /** Count of non-void calendar Receipts (status booked|held) created in the window, org-scoped.
   *  A "receipted booking" is a booking that produced a proof receipt at booking time. */
  count: number;
}

/** One bookings-needing-attention row for the owner worklist: the booking behind the aggregate
 *  count, with a human-recognizable handle (service + appointment time, non-PII) so the owner can
 *  act on it. `startsAt` is an ISO string (the report payload is JSON-serialized and cached). */
export interface ReceiptedBookingWorklistItem {
  bookingId: string;
  /** The booked service, e.g. "Botox consult" (Booking.service). */
  service: string;
  /** Appointment start, ISO-8601 (Booking.startsAt). */
  startsAt: string;
  attributionConfidence: AttributionConfidence;
  /** Distinct OPEN exception codes for this booking, in canonical taxonomy order. */
  openExceptionCodes: ExceptionCode[];
  /** ISO-8601 issuance timestamp from the persisted ReceiptedBooking row; null when no row
   *  has been minted yet (pre-hook bookings). Null means flag_duplicate / resolve_exception
   *  are unavailable; override_attribution is always available (it mints the row on first call). */
  issuedAt: string | null;
  /** True when the booking carries a non-null overriddenBy (the owner has asserted attribution). */
  overridden: boolean;
}

/** Proof-quality breakdown of the receipted-booking cohort: how attributable each booking is, and
 *  which bookings are missing the evidence the proof chain needs. Computed lazily over the slice-4
 *  read-projection (`receiptedBookings.listForCohort`), so `cohortSize` matches `receiptedBookings.count`
 *  except for orphaned cohort rows (booking hard-deleted) the read-projection filters out. */
export interface ReceiptedBookingQualityData {
  /** Receipted bookings analyzed this window. Matches `receiptedBookings.count` except for orphaned
   *  cohort rows (booking hard-deleted) the read-projection filters out. */
  cohortSize: number;
  /** Count of receipted bookings at each attribution-confidence rung; sums to `cohortSize`. */
  confidence: Record<AttributionConfidence, number>;
  /** Count of receipted bookings carrying each OPEN exception code (a booking can appear under several). */
  exceptions: Record<ExceptionCode, number>;
  /** Distinct receipted bookings with at least one open exception (the worklist size). */
  bookingsNeedingAttention: number;
  /** The bookings behind `bookingsNeedingAttention`, worst-first, capped (the drill-down worklist).
   *  `worklist.length <= bookingsNeedingAttention`; when capped the consumer surfaces "N of M". */
  worklist: ReceiptedBookingWorklistItem[];
}

/** Weekly receipted-booking REVENUE: the sum of per-booking expected value over the cohort, in CENTS.
 *  Uses the stable snapshot (expectedValueAtIssue) when a persisted issuance row exists; falls back to
 *  the live Opportunity value for pre-hook bookings so historical bookings are not silently zero.
 *  NaN-safe: only finite, nonnegative terms sum, so revenueCents never renders NaN. Advances the
 *  north star from count to proven booked revenue. */
export interface ReceiptedBookingRevenueData {
  /** Sum of expected value over the cohort, CENTS. Only finite, nonnegative terms sum (never NaN). */
  revenueCents: number;
  /** ISO-4217 currency of the snapshotted values (org default); null when none carried a currency. */
  currency: string | null;
  /** Cohort members that contributed a finite value (others had no opportunity / null snapshot). */
  bookingsWithValue: number;
  /** Total receipted-booking cohort this window (matches receiptedBookings.count, modulo orphans). */
  cohortSize: number;
}

export interface ReportDataV1 {
  label: ReportWindow;
  period: string;
  dateFolio: string;
  pullquote: PullQuoteCopy;
  attribution: AttributionData;
  funnel: FunnelRowData[];
  funnelNarrative: FunnelNarrative;
  campaigns: CampaignRow[];
  cost: CostBreakdown;
  costNarrative: string;
  managedComparison: ManagedComparisonData | null;
  heldRate: HeldRateData;
  consentCompleteness: ConsentCompletenessData;
  receiptedBookings: ReceiptedBookingsData;
  receiptedBookingQuality: ReceiptedBookingQualityData;
  receiptedBookingRevenue: ReceiptedBookingRevenueData;
}

// ---------------------------------------------------------------------------
// Report insights provider — injected into core from ad-optimizer via apps/api
// ---------------------------------------------------------------------------

export interface ReportInsightsMetrics {
  impressions: number;
  inlineLinkClicks: number;
  landingPageViews: number;
  spend: number;
}

export interface ReportInsightsProvider {
  getAggregateMetrics(dateRange: { since: string; until: string }): Promise<ReportInsightsMetrics>;
  getCampaignMetrics(dateRange: { since: string; until: string }): Promise<ReportCampaignInsight[]>;
}
