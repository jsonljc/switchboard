// ---------------------------------------------------------------------------
// Write provider types for the digital-ads cartridge.
// Extracted from types.ts to keep individual files under the 600-line limit.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Campaign/Ad Set types (for write actions)
// ---------------------------------------------------------------------------

export interface CampaignInfo {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudget: number;
  lifetimeBudget: number | null;
  deliveryStatus: string | null;
  startTime: string | null;
  endTime: string | null;
  objective: string | null;
}

export interface AdSetInfo {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudget: number;
  lifetimeBudget: number | null;
  deliveryStatus: string | null;
  startTime: string | null;
  endTime: string | null;
  targeting: Record<string, unknown> | null;
  campaignId: string;
}

// ---------------------------------------------------------------------------
// Meta Ads write provider interface
// ---------------------------------------------------------------------------

export interface MetaAdsWriteProvider {
  // --- Existing methods ---
  getCampaign(campaignId: string): Promise<CampaignInfo>;
  searchCampaigns(query: string): Promise<CampaignInfo[]>;
  pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }>;
  resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }>;
  updateBudget(
    campaignId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }>;
  getAdSet(adSetId: string): Promise<AdSetInfo>;
  pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }>;
  resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }>;
  updateAdSetBudget(
    adSetId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }>;
  updateTargeting(
    adSetId: string,
    targetingSpec: Record<string, unknown>,
  ): Promise<{ success: boolean }>;
  createCampaign(params: CreateCampaignParams): Promise<{ id: string; success: boolean }>;
  createAdSet(params: CreateAdSetParams): Promise<{ id: string; success: boolean }>;
  createAd(params: CreateAdParams): Promise<{ id: string; success: boolean }>;
  healthCheck(): Promise<import("@switchboard/schemas").ConnectionHealth>;

  // --- Audience methods (Phase 3) ---
  createCustomAudience(
    params: CreateCustomAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }>;
  createLookalikeAudience(
    params: CreateLookalikeAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }>;
  deleteCustomAudience(audienceId: string): Promise<{ success: boolean }>;

  // --- Bid & Schedule methods (Phase 4) ---
  updateBidStrategy(
    adSetId: string,
    bidStrategy: string,
    bidAmount?: number,
  ): Promise<{ success: boolean; previousBidStrategy: string }>;
  updateAdSetSchedule(
    adSetId: string,
    schedule: Array<Record<string, unknown>>,
  ): Promise<{ success: boolean }>;
  updateCampaignObjective(
    campaignId: string,
    objective: string,
  ): Promise<{ success: boolean; previousObjective: string }>;

  // --- Creative methods (Phase 5) ---
  createAdCreative(params: CreateAdCreativeWriteParams): Promise<{ id: string; success: boolean }>;
  updateAdStatus(
    adId: string,
    status: string,
  ): Promise<{ success: boolean; previousStatus: string }>;

  // --- Experiment methods (Phase 6) ---
  createAdStudy(params: CreateAdStudyWriteParams): Promise<{ id: string; success: boolean }>;
  concludeExperiment(studyId: string, winnerCellId: string): Promise<{ success: boolean }>;

  // --- Rule methods (Phase 7) ---
  createAdRule(params: CreateAdRuleWriteParams): Promise<{ id: string; success: boolean }>;
  deleteAdRule(ruleId: string): Promise<{ success: boolean }>;

  // --- Lead Forms API (for speed-to-lead) ---
  getLeadForms(pageId: string): Promise<LeadFormInfo[]>;
  getLeadFormData(formId: string, options?: { since?: number }): Promise<LeadFormEntry[]>;

  // --- Conversions API (CAPI) ---
  sendConversionEvent(
    pixelId: string,
    event: ConversionEvent,
  ): Promise<{ eventsReceived: number; success: boolean }>;

  // --- Insights API ---
  getAccountInsights(
    accountId: string,
    options: InsightsOptions,
  ): Promise<Record<string, unknown>[]>;
  getCampaignInsights(
    campaignId: string,
    options: InsightsOptions,
  ): Promise<Record<string, unknown>[]>;
}

export interface CreateCampaignParams {
  name: string;
  objective: string;
  dailyBudget: number;
  status?: string;
  specialAdCategories?: string[];
}

export interface CreateAdSetParams {
  campaignId: string;
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal?: string;
  billingEvent?: string;
  status?: string;
}

export interface CreateAdParams {
  adSetId: string;
  name: string;
  creative: Record<string, unknown>;
  status?: string;
}

// --- New param types for extended write actions ---

export interface CreateCustomAudienceWriteParams {
  name: string;
  description?: string;
  subtype: "WEBSITE" | "CUSTOM" | "ENGAGEMENT" | "OFFLINE_CONVERSION" | "APP";
  rule?: Record<string, unknown>;
  customerFileSource?: string;
  retentionDays?: number;
}

export interface CreateLookalikeAudienceWriteParams {
  name: string;
  sourceAudienceId: string;
  country: string;
  ratio: number;
}

export interface CreateAdCreativeWriteParams {
  name: string;
  objectStorySpec: Record<string, unknown>;
  degreesOfFreedomSpec?: Record<string, unknown>;
}

export interface CreateAdStudyWriteParams {
  name: string;
  description?: string;
  startTime: number;
  endTime: number;
  cells: Array<{
    name: string;
    adSetIds?: string[];
    campaignIds?: string[];
  }>;
  objective?: string;
  confidenceLevel?: number;
}

export interface CreateAdRuleWriteParams {
  name: string;
  evaluationSpec: Record<string, unknown>;
  executionSpec: Record<string, unknown>;
  scheduleSpec?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lead Forms & CAPI types
// ---------------------------------------------------------------------------

export interface LeadFormInfo {
  id: string;
  name: string;
  status: string;
  createdTime: string;
  pageId: string;
}

export interface LeadFormEntry {
  id: string;
  createdTime: string;
  fieldData: Array<{ name: string; values: string[] }>;
}

export interface ConversionEvent {
  eventName: string;
  eventTime: number;
  userData: {
    em?: string[];
    ph?: string[];
    fn?: string[];
    ln?: string[];
    externalId?: string[];
  };
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
  actionSource: "website" | "app" | "phone_call" | "chat" | "email" | "system_generated" | "other";
}

export interface InsightsOptions {
  dateRange: { since: string; until: string };
  fields: string[];
  breakdowns?: string[];
  level?: "account" | "campaign" | "adset" | "ad";
}
