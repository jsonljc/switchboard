import type {
  ReportData,
  ReportWindow,
  Delta,
  PullQuoteCopy,
  AttributionData,
  FunnelRowData,
  FunnelNarrative,
  CampaignRow,
  CostBreakdown,
  HeldRateData,
  ConsentCompletenessData,
  RecoveryCandidatesData,
  ReceiptedBookingsData,
  ReceiptedBookingQualityData,
  ReceiptedBookingRevenueData,
  ManagedComparisonData,
} from "./types";

export interface ResultsModel {
  window: ReportWindow;
  period: string;
  dateFolio: string;
  pullquote: PullQuoteCopy;
  attribution: AttributionData;
  bookings: number; // the Bookings funnel stage, found by name
  bookingsDelta: Delta | null;
  adSpend: number; // Σ campaigns[].spend (dollars) — NOT cost.paid
  funnel: FunnelRowData[];
  funnelNarrative: FunnelNarrative;
  campaigns: CampaignRow[];
  bestCampaign: CampaignRow | null; // max roas, spend > 0
  worstCampaign: CampaignRow | null; // min roas, spend > 0
  cost: CostBreakdown;
  costNarrative: string;
  heldRate: HeldRateData; // attended / matured, rate null when no matured bookings
  consentCompleteness: ConsentCompletenessData; // validConsent / bookable, point-in-time snapshot
  recoveryCandidates: RecoveryCandidatesData; // no-show count in the period (recovery opportunity size)
  receiptedBookings: ReceiptedBookingsData; // count of non-void calendar receipts in the window
  receiptedBookingQuality: ReceiptedBookingQualityData; // confidence breakdown + exceptions worklist
  receiptedBookingRevenue: ReceiptedBookingRevenueData; // Σ expectedValueAtIssue (cents), snapshot-else-live
  managedComparison: ManagedComparisonData | null;
}

/** Booked consults come from the Bookings stage, located by name — the funnel
 *  has 6 stages and Bookings is not guaranteed to be the last row. */
function findBookings(funnel: FunnelRowData[]): FunnelRowData | undefined {
  return funnel.find((f) => f.stage === "Bookings");
}

export function buildResultsModel(data: ReportData): ResultsModel {
  const bookingsRow = findBookings(data.funnel);
  const spending = data.campaigns.filter((c) => c.spend > 0);
  const bestCampaign = spending.length
    ? spending.reduce((a, b) => (b.roas > a.roas ? b : a))
    : null;
  const worstCampaign = spending.length
    ? spending.reduce((a, b) => (b.roas < a.roas ? b : a))
    : null;

  return {
    window: data.label,
    period: data.period,
    dateFolio: data.dateFolio,
    pullquote: data.pullquote,
    attribution: data.attribution,
    bookings: bookingsRow?.n ?? 0,
    bookingsDelta: bookingsRow?.delta ?? null,
    adSpend: data.campaigns.reduce((s, c) => s + c.spend, 0),
    funnel: data.funnel,
    funnelNarrative: data.funnelNarrative,
    campaigns: data.campaigns,
    bestCampaign,
    worstCampaign,
    cost: data.cost,
    costNarrative: data.costNarrative,
    heldRate: data.heldRate ?? { attended: 0, matured: 0, rate: null },
    consentCompleteness: data.consentCompleteness ?? { validConsent: 0, bookable: 0, rate: null },
    recoveryCandidates: data.recoveryCandidates ?? { noShows: 0 },
    receiptedBookings: data.receiptedBookings ?? { count: 0 },
    // Normalize the nested worklist too: a payload cached after the quality block shipped but before
    // the worklist field has the block present (so the whole-object fallback won't fire) yet no
    // worklist key. Default it to [] or the tile crashes on worklist.map for up to one cache TTL.
    receiptedBookingQuality: data.receiptedBookingQuality
      ? {
          ...data.receiptedBookingQuality,
          worklist: data.receiptedBookingQuality.worklist ?? [],
        }
      : {
          cohortSize: 0,
          confidence: { deterministic: 0, high: 0, medium: 0, low: 0, unattributed: 0 },
          exceptions: {
            missing_source: 0,
            missing_consent: 0,
            manual_override: 0,
            duplicate_contact_risk: 0,
          },
          bookingsNeedingAttention: 0,
          worklist: [],
        },
    // Per-FIELD default, not a whole-object `??`: a report payload cached BEFORE the paid dimension
    // shipped carries the old 4-field object (truthy), so a whole-object fallback would not fire and
    // the new paid fields would read undefined -> NaN in the tile. Default each field so a stale
    // cache renders paid as 0, never NaN.
    receiptedBookingRevenue: {
      revenueCents: data.receiptedBookingRevenue?.revenueCents ?? 0,
      currency: data.receiptedBookingRevenue?.currency ?? null,
      bookingsWithValue: data.receiptedBookingRevenue?.bookingsWithValue ?? 0,
      cohortSize: data.receiptedBookingRevenue?.cohortSize ?? 0,
      paidRevenueCents: data.receiptedBookingRevenue?.paidRevenueCents ?? 0,
      paidBookings: data.receiptedBookingRevenue?.paidBookings ?? 0,
    },
    managedComparison: data.managedComparison,
  };
}

/** ROAS / return ratio as "N×". Per-campaign roas is the ONLY return ratio we show. */
export function fmtRatio(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}×`;
}
