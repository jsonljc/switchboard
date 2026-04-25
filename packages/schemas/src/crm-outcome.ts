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
  leadToQualifiedRate: number;
  qualifiedToBookingRate: number;
  bookingToClosedRate: number;
  leadToClosedRate: number;
}

// ── Media Benchmarks ──

export interface MediaBenchmarks {
  ctr: number;
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
  ctr: number;
  destinationType?: string;
  hasFrequencyCap?: boolean;
}

export interface CampaignInsightsProvider {
  getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
  }): Promise<CampaignLearningInput>;

  getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
  }): Promise<TargetBreachResult>;
}
