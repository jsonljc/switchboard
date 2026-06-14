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
    managedComparison: data.managedComparison,
  };
}

/** ROAS / return ratio as "N×". Per-campaign roas is the ONLY return ratio we show. */
export function fmtRatio(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}×`;
}
