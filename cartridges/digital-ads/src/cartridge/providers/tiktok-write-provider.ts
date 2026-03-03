// ---------------------------------------------------------------------------
// TikTokAdsWriteProvider — production implementation for write operations
// ---------------------------------------------------------------------------
// Uses the TikTok Marketing API for campaign and ad group mutations.
// Follows the same interface pattern as MetaAdsWriteProvider.
// ---------------------------------------------------------------------------

import type {
  CampaignInfo,
  AdSetInfo,
  ConnectionHealth,
  MetaAdsWriteProvider,
  CreateCampaignParams,
  CreateAdSetParams,
  CreateAdParams,
} from "../types.js";
import { CircuitBreaker } from "@switchboard/core";

export interface TikTokAdsWriteConfig {
  /** TikTok Marketing API access token */
  accessToken: string;
  /** Advertiser ID */
  advertiserId: string;
  /** API version (default: v1.3) */
  apiVersion?: string;
}

export class RealTikTokAdsWriteProvider implements MetaAdsWriteProvider {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly advertiserId: string;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: TikTokAdsWriteConfig) {
    const apiVersion = config.apiVersion ?? "v1.3";
    this.baseUrl = `https://business-api.tiktok.com/open_api/${apiVersion}`;
    this.accessToken = config.accessToken;
    this.advertiserId = config.advertiserId;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
    });
  }

  private headers(): Record<string, string> {
    return {
      "Access-Token": this.accessToken,
      "Content-Type": "application/json",
    };
  }

  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    const data = await this.apiGet("/campaign/get/", {
      advertiser_id: this.advertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    });
    const campaigns = (data.data?.list ?? []) as Record<string, unknown>[];
    if (campaigns.length === 0) throw new Error(`Campaign not found: ${campaignId}`);
    return this.parseCampaign(campaigns[0]!);
  }

  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    const params: Record<string, string> = {
      advertiser_id: this.advertiserId,
    };
    if (query) {
      params.filtering = JSON.stringify({ campaign_name: query });
    }
    const data = await this.apiGet("/campaign/get/", params);
    const list = (data.data?.list ?? []) as Record<string, unknown>[];
    return list.map((c) => this.parseCampaign(c));
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    await this.apiPost("/campaign/status/update/", {
      advertiser_id: this.advertiserId,
      campaign_ids: [campaignId],
      opt_status: "DISABLE",
    });
    return { success: true, previousStatus };
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    await this.apiPost("/campaign/status/update/", {
      advertiser_id: this.advertiserId,
      campaign_ids: [campaignId],
      opt_status: "ENABLE",
    });
    return { success: true, previousStatus };
  }

  async updateBudget(
    campaignId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const current = await this.getCampaign(campaignId);
    const previousBudget = current.dailyBudget;

    const budgetDollars = newBudgetCents / 100;
    await this.apiPost("/campaign/update/", {
      advertiser_id: this.advertiserId,
      campaign_id: campaignId,
      budget: budgetDollars,
    });
    return { success: true, previousBudget };
  }

  async getAdSet(adSetId: string): Promise<AdSetInfo> {
    const data = await this.apiGet("/adgroup/get/", {
      advertiser_id: this.advertiserId,
      filtering: JSON.stringify({ adgroup_ids: [adSetId] }),
    });
    const adGroups = (data.data?.list ?? []) as Record<string, unknown>[];
    if (adGroups.length === 0) throw new Error(`Ad group not found: ${adSetId}`);
    return this.parseAdGroup(adGroups[0]!);
  }

  async pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    await this.apiPost("/adgroup/status/update/", {
      advertiser_id: this.advertiserId,
      adgroup_ids: [adSetId],
      opt_status: "DISABLE",
    });
    return { success: true, previousStatus };
  }

  async resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    await this.apiPost("/adgroup/status/update/", {
      advertiser_id: this.advertiserId,
      adgroup_ids: [adSetId],
      opt_status: "ENABLE",
    });
    return { success: true, previousStatus };
  }

  async updateAdSetBudget(
    adSetId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const current = await this.getAdSet(adSetId);
    const previousBudget = current.dailyBudget;

    const budgetDollars = newBudgetCents / 100;
    await this.apiPost("/adgroup/update/", {
      advertiser_id: this.advertiserId,
      adgroup_id: adSetId,
      budget: budgetDollars,
    });
    return { success: true, previousBudget };
  }

  async updateTargeting(
    adSetId: string,
    targetingSpec: Record<string, unknown>,
  ): Promise<{ success: boolean }> {
    await this.apiPost("/adgroup/update/", {
      advertiser_id: this.advertiserId,
      adgroup_id: adSetId,
      ...targetingSpec,
    });
    return { success: true };
  }

  async createCampaign(params: CreateCampaignParams): Promise<{ id: string; success: boolean }> {
    const data = await this.apiPost("/campaign/create/", {
      advertiser_id: this.advertiserId,
      campaign_name: params.name,
      objective_type: mapObjectiveToTikTok(params.objective),
      budget: params.dailyBudget,
      budget_mode: "BUDGET_MODE_DAY",
      operation_status: params.status === "ACTIVE" ? "ENABLE" : "DISABLE",
    });
    const id = String((data.data as Record<string, unknown>)?.campaign_id ?? "");
    return { id, success: true };
  }

  async createAdSet(params: CreateAdSetParams): Promise<{ id: string; success: boolean }> {
    const data = await this.apiPost("/adgroup/create/", {
      advertiser_id: this.advertiserId,
      campaign_id: params.campaignId,
      adgroup_name: params.name,
      budget: params.dailyBudget,
      budget_mode: "BUDGET_MODE_DAY",
      operation_status: params.status === "ACTIVE" ? "ENABLE" : "DISABLE",
      ...params.targeting,
    });
    const id = String((data.data as Record<string, unknown>)?.adgroup_id ?? "");
    return { id, success: true };
  }

  async createAd(params: CreateAdParams): Promise<{ id: string; success: boolean }> {
    const data = await this.apiPost("/ad/create/", {
      advertiser_id: this.advertiserId,
      adgroup_id: params.adSetId,
      ad_name: params.name,
      operation_status: params.status === "ACTIVE" ? "ENABLE" : "DISABLE",
      ...params.creative,
    });
    const id = String((data.data as Record<string, unknown>)?.ad_id ?? "");
    return { id, success: true };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      await this.apiGet("/campaign/get/", {
        advertiser_id: this.advertiserId,
        page_size: "1",
      });
      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
        capabilities: ["read", "write", "pause", "resume", "budget"],
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

  // ── Private helpers ──

  private async apiGet(
    path: string,
    params: Record<string, string>,
  ): Promise<{ code: number; message: string; data: Record<string, unknown> | null }> {
    return this.circuitBreaker.execute(async () => {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      const res = await fetch(url.toString(), { headers: this.headers() });
      if (!res.ok) throw new Error(`TikTok API error: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as {
        code: number;
        message: string;
        data: Record<string, unknown> | null;
      };
      if (json.code !== 0) throw new Error(`TikTok API error: ${json.code} ${json.message}`);
      return json;
    });
  }

  private async apiPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ code: number; message: string; data: Record<string, unknown> | null }> {
    return this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`TikTok API error: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as {
        code: number;
        message: string;
        data: Record<string, unknown> | null;
      };
      if (json.code !== 0) throw new Error(`TikTok API error: ${json.code} ${json.message}`);
      return json;
    });
  }

  private parseCampaign(row: Record<string, unknown>): CampaignInfo {
    return {
      id: String(row.campaign_id ?? ""),
      name: String(row.campaign_name ?? ""),
      status: mapTikTokStatus(String(row.operation_status ?? row.opt_status ?? "DISABLE")),
      dailyBudget: Number(row.budget ?? 0),
      lifetimeBudget: null,
      deliveryStatus: row.secondary_status ? String(row.secondary_status) : null,
      startTime: null,
      endTime: null,
      objective: row.objective_type ? String(row.objective_type) : null,
    };
  }

  private parseAdGroup(row: Record<string, unknown>): AdSetInfo {
    return {
      id: String(row.adgroup_id ?? ""),
      name: String(row.adgroup_name ?? ""),
      status: mapTikTokStatus(String(row.operation_status ?? row.opt_status ?? "DISABLE")),
      dailyBudget: Number(row.budget ?? 0),
      lifetimeBudget: null,
      deliveryStatus: row.secondary_status ? String(row.secondary_status) : null,
      startTime: null,
      endTime: null,
      targeting: null,
      campaignId: String(row.campaign_id ?? ""),
    };
  }
}

function mapTikTokStatus(status: string): "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED" {
  switch (status) {
    case "ENABLE":
      return "ACTIVE";
    case "DISABLE":
      return "PAUSED";
    case "DELETE":
      return "DELETED";
    default:
      return "PAUSED";
  }
}

function mapObjectiveToTikTok(objective: string): string {
  const map: Record<string, string> = {
    CONVERSIONS: "CONVERSIONS",
    REACH: "REACH",
    TRAFFIC: "TRAFFIC",
    VIDEO_VIEWS: "VIDEO_VIEWS",
    LEAD_GENERATION: "LEAD_GENERATION",
    APP_PROMOTION: "APP_PROMOTION",
  };
  return map[objective.toUpperCase()] ?? "CONVERSIONS";
}
