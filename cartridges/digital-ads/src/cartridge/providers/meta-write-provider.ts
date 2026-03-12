/* eslint-disable max-lines */
// ---------------------------------------------------------------------------
// MetaAdsWriteProvider — production implementation for write operations
// ---------------------------------------------------------------------------
// Delegates all HTTP operations to MetaGraphClient for shared auth,
// circuit breaker, retry, and rate limiting.
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
  LeadFormInfo,
  LeadFormEntry,
  ConversionEvent,
  InsightsOptions,
} from "../types.js";
import { MetaGraphClient } from "../../platforms/meta/graph-client.js";

export interface MetaAdsWriteConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion?: string;
  graphClient?: MetaGraphClient;
}

export class RealMetaAdsWriteProvider implements MetaAdsWriteProvider {
  private readonly client: MetaGraphClient;
  private readonly adAccountId: string;

  constructor(config: MetaAdsWriteConfig) {
    this.client =
      config.graphClient ??
      new MetaGraphClient({
        accessToken: config.accessToken,
        apiVersion: config.apiVersion,
      });
    this.adAccountId = config.adAccountId;
  }

  private get accountId(): string {
    return this.adAccountId.startsWith("act_") ? this.adAccountId : `act_${this.adAccountId}`;
  }

  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    const data = await this.client.request<Record<string, unknown>>(campaignId, {
      params: {
        fields:
          "id,name,status,daily_budget,lifetime_budget,effective_status,start_time,stop_time,objective",
      },
    });
    return this.parseCampaign(data);
  }

  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    const params: Record<string, string> = {
      fields:
        "id,name,status,daily_budget,lifetime_budget,effective_status,start_time,stop_time,objective",
    };
    if (query) {
      params.filtering = `[{"field":"name","operator":"CONTAIN","value":"${query}"}]`;
    }

    const items = await this.client.requestPaginated<Record<string, unknown>>(
      `${this.accountId}/campaigns`,
      params,
    );

    return items.map((item) => this.parseCampaign(item));
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    await this.client.request(campaignId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });

    return { success: true, previousStatus };
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    await this.client.request(campaignId, {
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
    await this.client.request(campaignId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [budgetField]: String(newBudgetCents) }),
    });

    return { success: true, previousBudget };
  }

  async getAdSet(adSetId: string): Promise<AdSetInfo> {
    const data = await this.client.request<Record<string, unknown>>(adSetId, {
      params: {
        fields:
          "id,name,status,daily_budget,lifetime_budget,effective_status,start_time,end_time,targeting,campaign_id",
      },
    });
    return this.parseAdSet(data);
  }

  async pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    await this.client.request(adSetId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });

    return { success: true, previousStatus };
  }

  async resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    await this.client.request(adSetId, {
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
    await this.client.request(adSetId, {
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
    await this.client.request(adSetId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targeting: targetingSpec }),
    });

    return { success: true };
  }

  async createCampaign(params: CreateCampaignParams): Promise<{ id: string; success: boolean }> {
    const body: Record<string, unknown> = {
      name: params.name,
      objective: params.objective,
      status: params.status ?? "PAUSED",
      special_ad_categories: params.specialAdCategories ?? [],
    };

    // Budget is in cents for the API
    body.daily_budget = String(Math.round(params.dailyBudget * 100));

    const data = await this.client.request<Record<string, unknown>>(`${this.accountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async createAdSet(params: CreateAdSetParams): Promise<{ id: string; success: boolean }> {
    const body: Record<string, unknown> = {
      campaign_id: params.campaignId,
      name: params.name,
      daily_budget: String(Math.round(params.dailyBudget * 100)),
      targeting: params.targeting,
      optimization_goal: params.optimizationGoal ?? "NONE",
      billing_event: params.billingEvent ?? "IMPRESSIONS",
      status: params.status ?? "PAUSED",
    };

    const data = await this.client.request<Record<string, unknown>>(`${this.accountId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { id: String(data.id), success: true };
  }

  async createAd(params: CreateAdParams): Promise<{ id: string; success: boolean }> {
    // First create the ad creative
    const creativeBody: Record<string, unknown> = {
      name: `${params.name} Creative`,
      object_story_spec: params.creative,
    };

    const creativeData = await this.client.request<Record<string, unknown>>(
      `${this.accountId}/adcreatives`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creativeBody),
      },
    );

    // Then create the ad referencing the creative
    const adBody: Record<string, unknown> = {
      name: params.name,
      adset_id: params.adSetId,
      creative: { creative_id: String(creativeData.id) },
      status: params.status ?? "PAUSED",
    };

    const data = await this.client.request<Record<string, unknown>>(`${this.accountId}/ads`, {
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
    const body: Record<string, unknown> = {
      name: params.name,
      subtype: params.subtype,
      description: params.description ?? "",
      customer_file_source: params.customerFileSource ?? "USER_PROVIDED_ONLY",
    };
    if (params.rule) body.rule = params.rule;
    if (params.retentionDays) body.retention_days = params.retentionDays;

    const data = await this.client.request<Record<string, unknown>>(
      `${this.accountId}/customaudiences`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    return { id: String(data.id), success: true };
  }

  async createLookalikeAudience(
    params: CreateLookalikeAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
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

    const data = await this.client.request<Record<string, unknown>>(
      `${this.accountId}/customaudiences`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    return { id: String(data.id), success: true };
  }

  async deleteCustomAudience(audienceId: string): Promise<{ success: boolean }> {
    await this.client.request(audienceId, { method: "DELETE" });
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
    const current = await this.client.request<Record<string, unknown>>(adSetId, {
      params: { fields: "bid_strategy,bid_amount" },
    });
    const previousBidStrategy = (current.bid_strategy as string) ?? "LOWEST_COST_WITHOUT_CAP";

    const body: Record<string, unknown> = { bid_strategy: bidStrategy };
    if (bidAmount !== undefined) body.bid_amount = String(bidAmount);

    await this.client.request(adSetId, {
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
    await this.client.request(adSetId, {
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

    await this.client.request(campaignId, {
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
    const body: Record<string, unknown> = {
      name: params.name,
      object_story_spec: params.objectStorySpec,
    };
    if (params.degreesOfFreedomSpec) {
      body.degrees_of_freedom_spec = params.degreesOfFreedomSpec;
    }

    const data = await this.client.request<Record<string, unknown>>(
      `${this.accountId}/adcreatives`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    return { id: String(data.id), success: true };
  }

  async updateAdStatus(
    adId: string,
    status: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.client.request<Record<string, unknown>>(adId, {
      params: { fields: "status" },
    });
    const previousStatus = (current.status as string) ?? "UNKNOWN";

    await this.client.request(adId, {
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

    const data = await this.client.request<Record<string, unknown>>(
      `${this.accountId}/ad_studies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    return { id: String(data.id), success: true };
  }

  async concludeExperiment(studyId: string, winnerCellId: string): Promise<{ success: boolean }> {
    const study = await this.client.request<Record<string, unknown>>(studyId, {
      params: { fields: "cells{id,name,adsets}" },
    });

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
    const body: Record<string, unknown> = {
      name: params.name,
      evaluation_spec: params.evaluationSpec,
      execution_spec: params.executionSpec,
    };
    if (params.scheduleSpec) body.schedule_spec = params.scheduleSpec;

    const data = await this.client.request<Record<string, unknown>>(
      `${this.accountId}/adrules_library`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    return { id: String(data.id), success: true };
  }

  async deleteAdRule(ruleId: string): Promise<{ success: boolean }> {
    await this.client.request(ruleId, { method: "DELETE" });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Lead Forms API (speed-to-lead)
  // ---------------------------------------------------------------------------

  async getLeadForms(pageId: string): Promise<LeadFormInfo[]> {
    const data = await this.client.request<{ data: Record<string, unknown>[] }>(
      `${pageId}/leadgen_forms`,
      { params: { fields: "id,name,status,created_time" } },
    );
    const forms = data.data ?? [];
    return forms.map((f) => ({
      id: String(f.id),
      name: String(f.name ?? ""),
      status: String(f.status ?? "ACTIVE"),
      createdTime: String(f.created_time ?? ""),
      pageId,
    }));
  }

  async getLeadFormData(formId: string, options?: { since?: number }): Promise<LeadFormEntry[]> {
    const params: Record<string, string> = {
      fields: "id,created_time,field_data",
    };
    if (options?.since) {
      params.filtering = `[{"field":"time_created","operator":"GREATER_THAN","value":${options.since}}]`;
    }

    const items = await this.client.requestPaginated<Record<string, unknown>>(
      `${formId}/leads`,
      params,
    );

    return items.map((item) => ({
      id: String(item.id),
      createdTime: String(item.created_time ?? ""),
      fieldData: (item.field_data ?? []) as LeadFormEntry["fieldData"],
    }));
  }

  // ---------------------------------------------------------------------------
  // Conversions API (CAPI)
  // ---------------------------------------------------------------------------

  async sendConversionEvent(
    pixelId: string,
    event: ConversionEvent,
  ): Promise<{ eventsReceived: number; success: boolean }> {
    const eventData: Record<string, unknown> = {
      event_name: event.eventName,
      event_time: event.eventTime,
      action_source: event.actionSource,
      user_data: event.userData,
    };
    if (event.customData) eventData.custom_data = event.customData;
    if (event.eventSourceUrl) eventData.event_source_url = event.eventSourceUrl;

    const data = await this.client.request<Record<string, unknown>>(`${pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [eventData] }),
    });

    return {
      eventsReceived: (data.events_received as number) ?? 1,
      success: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Insights API
  // ---------------------------------------------------------------------------

  async getAccountInsights(
    accountId: string,
    options: InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    const acctId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    return this.fetchInsightsEndpoint(`${acctId}/insights`, options);
  }

  async getCampaignInsights(
    campaignId: string,
    options: InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    return this.fetchInsightsEndpoint(`${campaignId}/insights`, options);
  }

  private async fetchInsightsEndpoint(
    path: string,
    options: InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = {
      fields: options.fields.join(","),
      time_range: JSON.stringify(options.dateRange),
    };
    if (options.breakdowns?.length) {
      params.breakdowns = options.breakdowns.join(",");
    }
    if (options.level) {
      params.level = options.level;
    }

    const data = await this.client.request<{ data: Record<string, unknown>[] }>(path, { params });
    return data.data ?? [];
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      await this.client.request("me");
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

  async createAdStudy(
    _params: CreateAdStudyWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    return { id: "study_new_1", success: true };
  }

  async concludeExperiment(_studyId: string, _winnerCellId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  async createAdRule(_params: CreateAdRuleWriteParams): Promise<{ id: string; success: boolean }> {
    return { id: "rule_new_1", success: true };
  }

  async deleteAdRule(_ruleId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  async getLeadForms(_pageId: string): Promise<LeadFormInfo[]> {
    return [
      {
        id: "form_1",
        name: "Contact Form",
        status: "ACTIVE",
        createdTime: "2026-01-01T00:00:00+0000",
        pageId: _pageId,
      },
    ];
  }

  async getLeadFormData(_formId: string, _options?: { since?: number }): Promise<LeadFormEntry[]> {
    return [
      {
        id: "lead_1",
        createdTime: "2026-03-01T10:00:00+0000",
        fieldData: [
          { name: "full_name", values: ["John Doe"] },
          { name: "email", values: ["john@example.com"] },
          { name: "phone_number", values: ["+1234567890"] },
        ],
      },
    ];
  }

  async sendConversionEvent(
    _pixelId: string,
    _event: ConversionEvent,
  ): Promise<{ eventsReceived: number; success: boolean }> {
    return { eventsReceived: 1, success: true };
  }

  async getAccountInsights(
    _accountId: string,
    _options: InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    return [{ spend: "1000.00", impressions: "50000", clicks: "2500", ctr: "5.0" }];
  }

  async getCampaignInsights(
    _campaignId: string,
    _options: InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    return [{ spend: "500.00", impressions: "25000", clicks: "1250", ctr: "5.0" }];
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
// Errors — re-exported from shared location for backward compatibility
// ---------------------------------------------------------------------------

export { MetaApiError, MetaRateLimitError, MetaAuthError } from "../../platforms/meta/errors.js";

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
