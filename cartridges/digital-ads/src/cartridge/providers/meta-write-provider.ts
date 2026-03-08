// ---------------------------------------------------------------------------
// MetaAdsWriteProvider — production implementation for write operations
// ---------------------------------------------------------------------------
// Ports the RealMetaAdsProvider pattern from ads-spend with campaign and
// ad set mutation support via the Meta Graph API.
// ---------------------------------------------------------------------------

import type {
  CampaignInfo,
  AdSetInfo,
  ConnectionHealth,
  MetaAdsWriteProvider,
  CreateCampaignParams,
  CreateAdSetParams,
  CreateAdParams,
  CreateCustomAudienceWriteParams,
  CreateLookalikeAudienceWriteParams,
  CreateAdCreativeWriteParams,
  CreateAdStudyWriteParams,
  CreateAdRuleWriteParams,
} from "../types.js";

export interface MetaAdsWriteConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion?: string;
}

export class RealMetaAdsWriteProvider implements MetaAdsWriteProvider {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly adAccountId: string;

  constructor(config: MetaAdsWriteConfig) {
    const apiVersion = config.apiVersion ?? "v21.0";
    this.baseUrl = `https://graph.facebook.com/${apiVersion}`;
    this.accessToken = config.accessToken;
    this.adAccountId = config.adAccountId;
  }

  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    const url =
      `${this.baseUrl}/${campaignId}?fields=` +
      "id,name,status,daily_budget,lifetime_budget,effective_status,start_time,stop_time,objective" +
      `&access_token=${this.accessToken}`;
    const data = await this.executeWithRetry(url);
    return this.parseCampaign(data);
  }

  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    let url =
      `${this.baseUrl}/${accountId}/campaigns?fields=` +
      "id,name,status,daily_budget,lifetime_budget,effective_status,start_time,stop_time,objective" +
      `&access_token=${this.accessToken}`;
    if (query) {
      url += `&filtering=[{"field":"name","operator":"CONTAIN","value":"${query}"}]`;
    }

    const results: CampaignInfo[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
      const data = await this.executeWithRetry(nextUrl);
      if (data.data) {
        for (const item of data.data as Record<string, unknown>[]) {
          results.push(this.parseCampaign(item));
        }
      }
      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }

    return results;
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    const url = `${this.baseUrl}/${campaignId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });

    return { success: true, previousStatus };
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    const url = `${this.baseUrl}/${campaignId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });

    return { success: true, previousStatus };
  }

  async updateBudget(
    campaignId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const current = await this.getCampaign(campaignId);
    const previousBudget = current.dailyBudget || current.lifetimeBudget || 0;

    const budgetField = current.lifetimeBudget ? "lifetime_budget" : "daily_budget";
    const url = `${this.baseUrl}/${campaignId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [budgetField]: String(newBudgetCents) }),
    });

    return { success: true, previousBudget };
  }

  async getAdSet(adSetId: string): Promise<AdSetInfo> {
    const url =
      `${this.baseUrl}/${adSetId}?fields=` +
      "id,name,status,daily_budget,lifetime_budget,effective_status,start_time,end_time,targeting,campaign_id" +
      `&access_token=${this.accessToken}`;
    const data = await this.executeWithRetry(url);
    return this.parseAdSet(data);
  }

  async pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    const url = `${this.baseUrl}/${adSetId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });

    return { success: true, previousStatus };
  }

  async resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    const url = `${this.baseUrl}/${adSetId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });

    return { success: true, previousStatus };
  }

  async updateAdSetBudget(
    adSetId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const current = await this.getAdSet(adSetId);
    const previousBudget = current.dailyBudget || current.lifetimeBudget || 0;

    const budgetField = current.lifetimeBudget ? "lifetime_budget" : "daily_budget";
    const url = `${this.baseUrl}/${adSetId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [budgetField]: String(newBudgetCents) }),
    });

    return { success: true, previousBudget };
  }

  async updateTargeting(
    adSetId: string,
    targetingSpec: Record<string, unknown>,
  ): Promise<{ success: boolean }> {
    const url = `${this.baseUrl}/${adSetId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targeting: targetingSpec }),
    });

    return { success: true };
  }

  async createCampaign(params: CreateCampaignParams): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/campaigns?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      objective: params.objective,
      status: params.status ?? "PAUSED",
      special_ad_categories: params.specialAdCategories ?? [],
    };

    // Budget is in cents for the API
    body.daily_budget = String(Math.round(params.dailyBudget * 100));

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async createAdSet(params: CreateAdSetParams): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/adsets?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      campaign_id: params.campaignId,
      name: params.name,
      daily_budget: String(Math.round(params.dailyBudget * 100)),
      targeting: params.targeting,
      optimization_goal: params.optimizationGoal ?? "NONE",
      billing_event: params.billingEvent ?? "IMPRESSIONS",
      status: params.status ?? "PAUSED",
    };

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async createAd(params: CreateAdParams): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;

    // First create the ad creative
    const creativeUrl = `${this.baseUrl}/${accountId}/adcreatives?access_token=${this.accessToken}`;
    const creativeBody: Record<string, unknown> = {
      name: `${params.name} Creative`,
      object_story_spec: params.creative,
    };

    const creativeData = await this.executeWithRetry(creativeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creativeBody),
    });

    // Then create the ad referencing the creative
    const adUrl = `${this.baseUrl}/${accountId}/ads?access_token=${this.accessToken}`;
    const adBody: Record<string, unknown> = {
      name: params.name,
      adset_id: params.adSetId,
      creative: { creative_id: String(creativeData.id) },
      status: params.status ?? "PAUSED",
    };

    const data = await this.executeWithRetry(adUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adBody),
    });

    return { id: String(data.id), success: true };
  }

  // ---------------------------------------------------------------------------
  // Audience methods (Phase 3)
  // ---------------------------------------------------------------------------

  async createCustomAudience(
    params: CreateCustomAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/customaudiences?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      subtype: params.subtype,
      description: params.description ?? "",
      customer_file_source: params.customerFileSource ?? "USER_PROVIDED_ONLY",
    };
    if (params.rule) body.rule = params.rule;
    if (params.retentionDays) body.retention_days = params.retentionDays;

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async createLookalikeAudience(
    params: CreateLookalikeAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/customaudiences?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      subtype: "LOOKALIKE",
      origin_audience_id: params.sourceAudienceId,
      lookalike_spec: JSON.stringify({
        type: "similarity",
        country: params.country,
        ratio: params.ratio,
      }),
    };

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async deleteCustomAudience(audienceId: string): Promise<{ success: boolean }> {
    const url = `${this.baseUrl}/${audienceId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, { method: "DELETE" });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Bid & Schedule methods (Phase 4)
  // ---------------------------------------------------------------------------

  async updateBidStrategy(
    adSetId: string,
    bidStrategy: string,
    bidAmount?: number,
  ): Promise<{ success: boolean; previousBidStrategy: string }> {
    // Fetch current bid strategy before updating
    const currentUrl =
      `${this.baseUrl}/${adSetId}?fields=bid_strategy,bid_amount` +
      `&access_token=${this.accessToken}`;
    const current = await this.executeWithRetry(currentUrl);
    const previousBidStrategy = (current.bid_strategy as string) ?? "LOWEST_COST_WITHOUT_CAP";

    const body: Record<string, unknown> = { bid_strategy: bidStrategy };
    if (bidAmount !== undefined) body.bid_amount = String(bidAmount);

    const url = `${this.baseUrl}/${adSetId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { success: true, previousBidStrategy };
  }

  async updateAdSetSchedule(
    adSetId: string,
    schedule: Array<Record<string, unknown>>,
  ): Promise<{ success: boolean }> {
    const url = `${this.baseUrl}/${adSetId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adset_schedule: schedule,
        pacing_type: ["day_parting"],
      }),
    });
    return { success: true };
  }

  async updateCampaignObjective(
    campaignId: string,
    objective: string,
  ): Promise<{ success: boolean; previousObjective: string }> {
    const campaign = await this.getCampaign(campaignId);
    const previousObjective = campaign.objective ?? "UNKNOWN";

    const url = `${this.baseUrl}/${campaignId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective }),
    });

    return { success: true, previousObjective };
  }

  // ---------------------------------------------------------------------------
  // Creative methods (Phase 5)
  // ---------------------------------------------------------------------------

  async createAdCreative(
    params: CreateAdCreativeWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/adcreatives?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      object_story_spec: params.objectStorySpec,
    };
    if (params.degreesOfFreedomSpec) {
      body.degrees_of_freedom_spec = params.degreesOfFreedomSpec;
    }

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async updateAdStatus(
    adId: string,
    status: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    // Fetch current status
    const currentUrl = `${this.baseUrl}/${adId}?fields=status&access_token=${this.accessToken}`;
    const current = await this.executeWithRetry(currentUrl);
    const previousStatus = (current.status as string) ?? "UNKNOWN";

    const url = `${this.baseUrl}/${adId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    return { success: true, previousStatus };
  }

  // ---------------------------------------------------------------------------
  // Experiment methods (Phase 6)
  // ---------------------------------------------------------------------------

  async createAdStudy(params: CreateAdStudyWriteParams): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/ad_studies?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      description: params.description ?? "",
      start_time: params.startTime,
      end_time: params.endTime,
      type: "SPLIT_TEST",
      cells: params.cells.map((cell) => ({
        name: cell.name,
        adsets: cell.adSetIds ?? [],
        campaigns: cell.campaignIds ?? [],
      })),
    };
    if (params.objective) body.objective = params.objective;
    if (params.confidenceLevel) body.confidence_level = params.confidenceLevel;

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async concludeExperiment(studyId: string, winnerCellId: string): Promise<{ success: boolean }> {
    // Get study cells to find the losers
    const studyUrl =
      `${this.baseUrl}/${studyId}?fields=cells{id,name,adsets}` +
      `&access_token=${this.accessToken}`;
    const study = await this.executeWithRetry(studyUrl);

    const cells =
      ((study.cells as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ?? [];

    // Pause ad sets in losing cells
    for (const cell of cells) {
      if (String(cell.id) === winnerCellId) continue;
      const adSets = (cell.adsets as Array<Record<string, unknown>>) ?? [];
      for (const adSet of adSets) {
        try {
          await this.pauseAdSet(String(adSet.id));
        } catch {
          // Best-effort pause
        }
      }
    }

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Rule methods (Phase 7)
  // ---------------------------------------------------------------------------

  async createAdRule(params: CreateAdRuleWriteParams): Promise<{ id: string; success: boolean }> {
    const accountId = this.adAccountId.startsWith("act_")
      ? this.adAccountId
      : `act_${this.adAccountId}`;
    const url = `${this.baseUrl}/${accountId}/adrules_library?access_token=${this.accessToken}`;

    const body: Record<string, unknown> = {
      name: params.name,
      evaluation_spec: params.evaluationSpec,
      execution_spec: params.executionSpec,
    };
    if (params.scheduleSpec) body.schedule_spec = params.scheduleSpec;

    const data = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async deleteAdRule(ruleId: string): Promise<{ success: boolean }> {
    const url = `${this.baseUrl}/${ruleId}?access_token=${this.accessToken}`;
    await this.executeWithRetry(url, { method: "DELETE" });
    return { success: true };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      await this.executeWithRetry(`${this.baseUrl}/me?access_token=${this.accessToken}`);
      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
        capabilities: [
          "campaigns",
          "adsets",
          "targeting",
          "reporting",
          "signal_health",
          "audiences",
          "bid_strategy",
          "budget_optimization",
          "creatives",
          "experiments",
          "rules",
          "strategy",
        ],
      };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        capabilities: [],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async executeWithRetry(
    url: string,
    init?: RequestInit,
    retries = 3,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, init);
      const body = (await response.json()) as Record<string, unknown>;

      if (response.ok) return body;

      const error = body.error as Record<string, unknown> | undefined;
      const code = error?.code as number | undefined;

      // Rate limit — retry with backoff
      if (code === 17 && attempt < retries) {
        await this.delay(Math.pow(2, attempt) * 1000);
        continue;
      }

      // Auth error — no retry
      if (code === 190) {
        throw new MetaAuthError(
          (error?.message as string) ?? "Authentication failed",
          code,
          (error?.error_subcode as number) ?? 0,
          error?.fbtrace_id as string | undefined,
        );
      }

      // 5xx — retry with backoff
      if (response.status >= 500 && attempt < retries) {
        await this.delay(Math.pow(2, attempt) * 1000);
        continue;
      }

      throw new MetaApiError(
        (error?.message as string) ?? `HTTP ${response.status}`,
        code ?? response.status,
        (error?.error_subcode as number) ?? 0,
        (error?.type as string) ?? "unknown",
        error?.fbtrace_id as string | undefined,
      );
    }

    throw new Error("Max retries exceeded");
  }

  /* istanbul ignore next -- simple timer */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseCampaign(raw: Record<string, unknown>): CampaignInfo {
    return {
      id: String(raw.id),
      name: String(raw.name ?? ""),
      status: (raw.status as CampaignInfo["status"]) ?? "ACTIVE",
      dailyBudget: Number(raw.daily_budget ?? 0),
      lifetimeBudget: raw.lifetime_budget ? Number(raw.lifetime_budget) : null,
      deliveryStatus: (raw.effective_status as string) ?? null,
      startTime: (raw.start_time as string) ?? null,
      endTime: (raw.stop_time as string) ?? null,
      objective: (raw.objective as string) ?? null,
    };
  }

  private parseAdSet(raw: Record<string, unknown>): AdSetInfo {
    return {
      id: String(raw.id),
      name: String(raw.name ?? ""),
      status: (raw.status as AdSetInfo["status"]) ?? "ACTIVE",
      dailyBudget: Number(raw.daily_budget ?? 0),
      lifetimeBudget: raw.lifetime_budget ? Number(raw.lifetime_budget) : null,
      deliveryStatus: (raw.effective_status as string) ?? null,
      startTime: (raw.start_time as string) ?? null,
      endTime: (raw.end_time as string) ?? null,
      targeting: (raw.targeting as Record<string, unknown>) ?? null,
      campaignId: String(raw.campaign_id ?? ""),
    };
  }
}

// ---------------------------------------------------------------------------
// Mock provider for testing
// ---------------------------------------------------------------------------

export class MockMetaAdsWriteProvider implements MetaAdsWriteProvider {
  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    return {
      id: campaignId,
      name: "Summer Sale 2026 - US",
      status: "ACTIVE",
      dailyBudget: 5000,
      lifetimeBudget: null,
      deliveryStatus: "ACTIVE",
      startTime: "2026-01-01T00:00:00+0000",
      endTime: null,
      objective: "OUTCOME_SALES",
    };
  }

  async searchCampaigns(_query: string): Promise<CampaignInfo[]> {
    return [
      {
        id: "campaign_1",
        name: "Summer Sale 2026 - US",
        status: "ACTIVE",
        dailyBudget: 50000,
        lifetimeBudget: null,
        deliveryStatus: "ACTIVE",
        startTime: "2026-01-01T00:00:00+0000",
        endTime: null,
        objective: "OUTCOME_SALES",
      },
      {
        id: "campaign_2",
        name: "Brand Awareness Q1",
        status: "ACTIVE",
        dailyBudget: 30000,
        lifetimeBudget: null,
        deliveryStatus: "LEARNING",
        startTime: "2026-01-15T00:00:00+0000",
        endTime: null,
        objective: "OUTCOME_AWARENESS",
      },
    ];
  }

  async pauseCampaign(_campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    return { success: true, previousStatus: "ACTIVE" };
  }

  async resumeCampaign(_campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    return { success: true, previousStatus: "PAUSED" };
  }

  async updateBudget(
    _campaignId: string,
    _newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    return { success: true, previousBudget: 5000 };
  }

  async getAdSet(adSetId: string): Promise<AdSetInfo> {
    return {
      id: adSetId,
      name: "US Audience 25-34",
      status: "ACTIVE",
      dailyBudget: 2500,
      lifetimeBudget: null,
      deliveryStatus: "ACTIVE",
      startTime: "2026-01-01T00:00:00+0000",
      endTime: null,
      targeting: { geo_locations: { countries: ["US"] } },
      campaignId: "campaign_1",
    };
  }

  async pauseAdSet(_adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    return { success: true, previousStatus: "ACTIVE" };
  }

  async resumeAdSet(_adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    return { success: true, previousStatus: "PAUSED" };
  }

  async updateAdSetBudget(
    _adSetId: string,
    _newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    return { success: true, previousBudget: 2500 };
  }

  async updateTargeting(
    _adSetId: string,
    _targetingSpec: Record<string, unknown>,
  ): Promise<{ success: boolean }> {
    return { success: true };
  }

  async createCampaign(_params: CreateCampaignParams): Promise<{ id: string; success: boolean }> {
    return { id: "campaign_new_1", success: true };
  }

  async createAdSet(_params: CreateAdSetParams): Promise<{ id: string; success: boolean }> {
    return { id: "adset_new_1", success: true };
  }

  async createAd(_params: CreateAdParams): Promise<{ id: string; success: boolean }> {
    return { id: "ad_new_1", success: true };
  }

  // --- Audience methods (Phase 3) ---

  async createCustomAudience(
    _params: CreateCustomAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    return { id: "audience_custom_1", success: true };
  }

  async createLookalikeAudience(
    _params: CreateLookalikeAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    return { id: "audience_lal_1", success: true };
  }

  async deleteCustomAudience(_audienceId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  // --- Bid & Schedule methods (Phase 4) ---

  async updateBidStrategy(
    _adSetId: string,
    _bidStrategy: string,
    _bidAmount?: number,
  ): Promise<{ success: boolean; previousBidStrategy: string }> {
    return { success: true, previousBidStrategy: "LOWEST_COST_WITHOUT_CAP" };
  }

  async updateAdSetSchedule(
    _adSetId: string,
    _schedule: Array<Record<string, unknown>>,
  ): Promise<{ success: boolean }> {
    return { success: true };
  }

  async updateCampaignObjective(
    _campaignId: string,
    _objective: string,
  ): Promise<{ success: boolean; previousObjective: string }> {
    return { success: true, previousObjective: "OUTCOME_SALES" };
  }

  // --- Creative methods (Phase 5) ---

  async createAdCreative(
    _params: CreateAdCreativeWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    return { id: "creative_new_1", success: true };
  }

  async updateAdStatus(
    _adId: string,
    _status: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    return { success: true, previousStatus: "ACTIVE" };
  }

  // --- Experiment methods (Phase 6) ---

  async createAdStudy(
    _params: CreateAdStudyWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    return { id: "study_new_1", success: true };
  }

  async concludeExperiment(_studyId: string, _winnerCellId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  // --- Rule methods (Phase 7) ---

  async createAdRule(_params: CreateAdRuleWriteParams): Promise<{ id: string; success: boolean }> {
    return { id: "rule_new_1", success: true };
  }

  async deleteAdRule(_ruleId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    return {
      status: "connected",
      latencyMs: 5,
      error: null,
      capabilities: [
        "campaigns",
        "adsets",
        "targeting",
        "reporting",
        "signal_health",
        "audiences",
        "bid_strategy",
        "budget_optimization",
        "creatives",
        "experiments",
        "rules",
        "strategy",
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly subcode: number,
    public readonly type: string,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class MetaRateLimitError extends MetaApiError {
  constructor(message: string, subcode: number, fbtraceId?: string) {
    super(message, 17, subcode, "OAuthException", fbtraceId);
    this.name = "MetaRateLimitError";
  }
}

export class MetaAuthError extends MetaApiError {
  constructor(message: string, code: number, subcode: number, fbtraceId?: string) {
    super(message, code, subcode, "OAuthException", fbtraceId);
    this.name = "MetaAuthError";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetaAdsWriteProvider(config: MetaAdsWriteConfig): MetaAdsWriteProvider {
  if (
    !config.accessToken ||
    config.accessToken.length < 20 ||
    config.accessToken === "mock-token"
  ) {
    return new MockMetaAdsWriteProvider();
  }
  return new RealMetaAdsWriteProvider(config);
}
