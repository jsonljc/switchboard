import type { CampaignInsightSchema as CampaignInsight } from "./ad-optimizer.js";

// ── CRM Funnel Data ──

export interface CrmFunnelData {
  campaignIds: string[];
  leads: number;
  qualified: number;
  opportunities: number;
  bookings: number;
  closed: number;
  revenue: number;

  rates: {
    leadToQualified: number | null;
    qualifiedToBooking: number | null;
    bookingToClosed: number | null;
    leadToClosed: number | null;
  };

  coverage: {
    attributedContacts: number;
    contactsWithEmailOrPhone: number;
    contactsWithOpportunity: number;
    contactsWithBooking: number;
    contactsWithRevenueEvent: number;
  };
}

// ── Funnel Benchmarks (CRM-only) ──

export interface FunnelBenchmarks {
  leadToQualifiedRate: number | null;
  qualifiedToBookingRate: number | null;
  bookingToClosedRate: number | null;
  leadToClosedRate: number | null;
}

// ── Media Benchmarks ──

export interface MediaBenchmarks {
  inlineLinkClickCtr: number;
  landingPageViewRate: number;
  clickToLeadRate?: number;
  cpl?: number;
  cpa?: number;
}

// ── CRM Data Provider ──

export interface CrmDataProvider {
  getFunnelData(input: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: Date;
    endDate: Date;
  }): Promise<CrmFunnelData>;

  getBenchmarks(input: {
    orgId: string;
    accountId: string;
    vertical?: string;
  }): Promise<FunnelBenchmarks>;
}

// ── Campaign Insights Provider ──

export interface WeeklyCampaignSnapshot {
  campaignId: string;
  startDate: Date;
  endDate: Date;
  spend: number;
  conversions: number;
  cpa: number | null;
}

export interface TargetBreachResult {
  periodsAboveTarget: number;
  granularity: "weekly" | "daily";
  isApproximate: boolean;
}

/** @deprecated Use AdSetLearningInput for ad-set-level learning status */
export interface CampaignLearningInput {
  effectiveStatus: string;
  learningPhase: boolean;
  lastModifiedDays: number;
  optimizationEvents: number;
}

export interface AdSetLearningInput {
  adSetId: string;
  adSetName: string;
  campaignId: string;
  learningStageStatus: "LEARNING" | "SUCCESS" | "FAIL" | "UNKNOWN";
  frequency: number;
  spend: number;
  conversions: number;
  cpa: number;
  roas: number;
  inlineLinkClickCtr: number;
  destinationType?: string;
  hasFrequencyCap?: boolean;
}

export interface CampaignInsightsProvider {
  getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    /** D2-7 batching: account-level learning rows pre-fetched once above the loop (optional). */
    prefetchedLearningRows?: CampaignInsight[];
  }): Promise<CampaignLearningInput>;

  getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
    /**
     * Phase-A Gate 1: when set, the conversions denominator for the breach test is
     * the value of this Meta `actions` action_type under a pinned attribution
     * window, not the unfiltered aggregate `conversions`. Unset ⇒ aggregate.
     */
    conversionActionType?: string;
    /** Attribution windows pinned for `conversionActionType`. Default ["7d_click"]. */
    attributionWindows?: string[];
    /** D2-7 batching: account-level daily breach rows pre-fetched once above the loop (optional). */
    prefetchedDailyRows?: CampaignInsight[];
  }): Promise<TargetBreachResult>;

  /**
   * D2-7 batching capability (optional): fetch the account-level daily breach window and the
   * 7-day learning window ONCE for the whole account. The audit-runner calls this above the
   * per-campaign loop and feeds the rows back into the two methods above as prefetched* inputs,
   * collapsing 2N account re-fetches to 2. Providers that omit it keep the per-campaign path.
   */
  prefetchAccountRows?(input: {
    endDate: Date;
    conversionActionType?: string;
    attributionWindows?: string[];
  }): Promise<{ daily: CampaignInsight[]; learning: CampaignInsight[] }>;
}
