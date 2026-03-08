// ---------------------------------------------------------------------------
// GoogleAdsWriteProvider — production implementation for write operations
// ---------------------------------------------------------------------------
// Uses the Google Ads REST API for campaign and ad set mutations.
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
  CreateCustomAudienceWriteParams,
  CreateLookalikeAudienceWriteParams,
  CreateAdCreativeWriteParams,
  CreateAdStudyWriteParams,
  CreateAdRuleWriteParams,
} from "../types.js";
import { CircuitBreaker } from "@switchboard/core";

export interface GoogleAdsWriteConfig {
  /** OAuth2 access token */
  accessToken: string;
  /** Google Ads customer/account ID */
  customerId: string;
  /** Developer token for API access */
  developerToken: string;
  /** Optional login-customer-id for MCC access */
  loginCustomerId?: string;
  /** API version (default: v17) */
  apiVersion?: string;
}

export class RealGoogleAdsWriteProvider implements MetaAdsWriteProvider {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly customerId: string;
  private readonly developerToken: string;
  private readonly loginCustomerId?: string;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: GoogleAdsWriteConfig) {
    const apiVersion = config.apiVersion ?? "v17";
    this.baseUrl = `https://googleads.googleapis.com/${apiVersion}/customers/${config.customerId}`;
    this.accessToken = config.accessToken;
    this.customerId = config.customerId;
    this.developerToken = config.developerToken;
    this.loginCustomerId = config.loginCustomerId;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
    });
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "developer-token": this.developerToken,
      "Content-Type": "application/json",
    };
    if (this.loginCustomerId) {
      h["login-customer-id"] = this.loginCustomerId;
    }
    return h;
  }

  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign.start_date, campaign.end_date, campaign.advertising_channel_type FROM campaign WHERE campaign.resource_name = 'customers/${this.customerId}/campaigns/${campaignId}'`;
    const data = await this.search(query);
    const row = data[0];
    if (!row) throw new Error(`Campaign not found: ${campaignId}`);
    return this.parseCampaign(row);
  }

  async searchCampaigns(query: string): Promise<CampaignInfo[]> {
    let gaql = `SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign.start_date, campaign.end_date, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'`;
    if (query) {
      // Sanitize: escape single quotes and backslashes to prevent GAQL injection
      const sanitized = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      gaql += ` AND campaign.name LIKE '%${sanitized}%'`;
    }
    const rows = await this.search(gaql);
    return rows.map((r) => this.parseCampaign(r));
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    await this.mutateCampaign(campaignId, { status: "PAUSED" });
    return { success: true, previousStatus };
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getCampaign(campaignId);
    const previousStatus = current.status;

    await this.mutateCampaign(campaignId, { status: "ENABLED" });
    return { success: true, previousStatus };
  }

  async updateBudget(
    campaignId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const current = await this.getCampaign(campaignId);
    const previousBudget = current.dailyBudget;

    // Google Ads budgets are in micros (1/1,000,000 of the currency)
    const budgetMicros = Math.round((newBudgetCents / 100) * 1_000_000);
    await this.mutateCampaignBudget(campaignId, budgetMicros);
    return { success: true, previousBudget };
  }

  async getAdSet(adSetId: string): Promise<AdSetInfo> {
    const query = `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.campaign, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.resource_name = 'customers/${this.customerId}/adGroups/${adSetId}'`;
    const data = await this.search(query);
    const row = data[0];
    if (!row) throw new Error(`Ad group not found: ${adSetId}`);
    return this.parseAdGroup(row);
  }

  async pauseAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    await this.mutateAdGroup(adSetId, { status: "PAUSED" });
    return { success: true, previousStatus };
  }

  async resumeAdSet(adSetId: string): Promise<{ success: boolean; previousStatus: string }> {
    const current = await this.getAdSet(adSetId);
    const previousStatus = current.status;

    await this.mutateAdGroup(adSetId, { status: "ENABLED" });
    return { success: true, previousStatus };
  }

  async updateAdSetBudget(
    adSetId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const current = await this.getAdSet(adSetId);
    const previousBudget = current.dailyBudget;

    const bidMicros = Math.round((newBudgetCents / 100) * 1_000_000);
    await this.mutateAdGroup(adSetId, { cpc_bid_micros: bidMicros });
    return { success: true, previousBudget };
  }

  async updateTargeting(
    adSetId: string,
    targetingSpec: Record<string, unknown>,
  ): Promise<{ success: boolean }> {
    // Google Ads targeting is set via ad group criterion mutations
    await this.mutateAdGroup(adSetId, { targeting: targetingSpec });
    return { success: true };
  }

  async createCampaign(params: CreateCampaignParams): Promise<{ id: string; success: boolean }> {
    const budgetMicros = Math.round(params.dailyBudget * 1_000_000);

    // First create the campaign budget
    const budgetRes = await this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}/campaignBudgets:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              create: {
                name: `${params.name} Budget`,
                amount_micros: budgetMicros,
                delivery_method: "STANDARD",
              },
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Google Ads API error: ${res.status} ${await res.text()}`);
      return res.json();
    });

    const budgetResourceName = (budgetRes as { results: Array<{ resourceName: string }> })
      .results[0]?.resourceName;

    // Then create the campaign
    const campaignRes = await this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}/campaigns:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              create: {
                name: params.name,
                status: params.status ?? "PAUSED",
                advertising_channel_type: params.objective ?? "SEARCH",
                campaign_budget: budgetResourceName,
              },
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Google Ads API error: ${res.status} ${await res.text()}`);
      return res.json();
    });

    const resourceName =
      (campaignRes as { results: Array<{ resourceName: string }> }).results[0]?.resourceName ?? "";
    const id = resourceName.split("/").pop() ?? "";
    return { id, success: true };
  }

  async createAdSet(params: CreateAdSetParams): Promise<{ id: string; success: boolean }> {
    const res = await this.circuitBreaker.execute(async () => {
      const r = await fetch(`${this.baseUrl}/adGroups:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              create: {
                name: params.name,
                campaign: `customers/${this.customerId}/campaigns/${params.campaignId}`,
                status: params.status ?? "PAUSED",
                cpc_bid_micros: Math.round(params.dailyBudget * 1_000_000),
              },
            },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Google Ads API error: ${r.status} ${await r.text()}`);
      return r.json();
    });

    const resourceName =
      (res as { results: Array<{ resourceName: string }> }).results[0]?.resourceName ?? "";
    const id = resourceName.split("/").pop() ?? "";
    return { id, success: true };
  }

  async createAd(params: CreateAdParams): Promise<{ id: string; success: boolean }> {
    const res = await this.circuitBreaker.execute(async () => {
      const r = await fetch(`${this.baseUrl}/adGroupAds:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              create: {
                ad_group: `customers/${this.customerId}/adGroups/${params.adSetId}`,
                status: params.status ?? "PAUSED",
                ad: params.creative,
              },
            },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Google Ads API error: ${r.status} ${await r.text()}`);
      return r.json();
    });

    const resourceName =
      (res as { results: Array<{ resourceName: string }> }).results[0]?.resourceName ?? "";
    const id = resourceName.split("/").pop() ?? "";
    return { id, success: true };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      await this.search("SELECT campaign.id FROM campaign LIMIT 1");
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

  // ── Extended interface methods (stubs — Google Ads equivalents) ──

  async createCustomAudience(
    _params: CreateCustomAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    throw new Error("createCustomAudience not yet implemented for Google Ads");
  }

  async createLookalikeAudience(
    _params: CreateLookalikeAudienceWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    throw new Error("createLookalikeAudience not yet implemented for Google Ads");
  }

  async deleteCustomAudience(_audienceId: string): Promise<{ success: boolean }> {
    throw new Error("deleteCustomAudience not yet implemented for Google Ads");
  }

  async updateBidStrategy(
    _adSetId: string,
    _bidStrategy: string,
    _bidAmount?: number,
  ): Promise<{ success: boolean; previousBidStrategy: string }> {
    throw new Error("updateBidStrategy not yet implemented for Google Ads");
  }

  async updateAdSetSchedule(
    _adSetId: string,
    _schedule: Array<Record<string, unknown>>,
  ): Promise<{ success: boolean }> {
    throw new Error("updateAdSetSchedule not yet implemented for Google Ads");
  }

  async updateCampaignObjective(
    _campaignId: string,
    _objective: string,
  ): Promise<{ success: boolean; previousObjective: string }> {
    throw new Error("updateCampaignObjective not yet implemented for Google Ads");
  }

  async createAdCreative(
    _params: CreateAdCreativeWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    throw new Error("createAdCreative not yet implemented for Google Ads");
  }

  async updateAdStatus(
    _adId: string,
    _status: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    throw new Error("updateAdStatus not yet implemented for Google Ads");
  }

  async createAdStudy(
    _params: CreateAdStudyWriteParams,
  ): Promise<{ id: string; success: boolean }> {
    throw new Error("createAdStudy not yet implemented for Google Ads");
  }

  async concludeExperiment(_studyId: string, _winnerCellId: string): Promise<{ success: boolean }> {
    throw new Error("concludeExperiment not yet implemented for Google Ads");
  }

  async createAdRule(_params: CreateAdRuleWriteParams): Promise<{ id: string; success: boolean }> {
    throw new Error("createAdRule not yet implemented for Google Ads");
  }

  async deleteAdRule(_ruleId: string): Promise<{ success: boolean }> {
    throw new Error("deleteAdRule not yet implemented for Google Ads");
  }

  // --- Lead Forms / CAPI / Insights stubs (Meta-specific, not applicable to Google) ---

  async getLeadForms(_pageId: string): Promise<import("../types.js").LeadFormInfo[]> {
    throw new Error("getLeadForms not applicable to Google Ads");
  }

  async getLeadFormData(
    _formId: string,
    _options?: { since?: number },
  ): Promise<import("../types.js").LeadFormEntry[]> {
    throw new Error("getLeadFormData not applicable to Google Ads");
  }

  async sendConversionEvent(
    _pixelId: string,
    _event: import("../types.js").ConversionEvent,
  ): Promise<{ eventsReceived: number; success: boolean }> {
    throw new Error("sendConversionEvent not yet implemented for Google Ads");
  }

  async getAccountInsights(
    _accountId: string,
    _options: import("../types.js").InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    throw new Error("getAccountInsights not yet implemented for Google Ads");
  }

  async getCampaignInsights(
    _campaignId: string,
    _options: import("../types.js").InsightsOptions,
  ): Promise<Record<string, unknown>[]> {
    throw new Error("getCampaignInsights not yet implemented for Google Ads");
  }

  // ── Private helpers ──

  private async search(gaql: string): Promise<Record<string, unknown>[]> {
    return this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}/googleAds:search`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ query: gaql }),
      });
      if (!res.ok) throw new Error(`Google Ads search error: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { results?: Record<string, unknown>[] };
      return json.results ?? [];
    });
  }

  private async mutateCampaign(
    campaignId: string,
    updates: Record<string, unknown>,
  ): Promise<void> {
    await this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}/campaigns:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resource_name: `customers/${this.customerId}/campaigns/${campaignId}`,
                ...updates,
              },
              update_mask: Object.keys(updates).join(","),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Google Ads mutate error: ${res.status} ${await res.text()}`);
    });
  }

  private async mutateCampaignBudget(campaignId: string, amountMicros: number): Promise<void> {
    // Fetch the budget resource name first
    const query = `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId}`;
    const rows = await this.search(query);
    const budgetResource = (rows[0] as { campaign?: { campaign_budget?: string } })?.campaign
      ?.campaign_budget;
    if (!budgetResource) throw new Error(`Budget not found for campaign ${campaignId}`);

    await this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}/campaignBudgets:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resource_name: budgetResource,
                amount_micros: amountMicros,
              },
              update_mask: "amount_micros",
            },
          ],
        }),
      });
      if (!res.ok)
        throw new Error(`Google Ads budget mutate error: ${res.status} ${await res.text()}`);
    });
  }

  private async mutateAdGroup(adGroupId: string, updates: Record<string, unknown>): Promise<void> {
    await this.circuitBreaker.execute(async () => {
      const res = await fetch(`${this.baseUrl}/adGroups:mutate`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resource_name: `customers/${this.customerId}/adGroups/${adGroupId}`,
                ...updates,
              },
              update_mask: Object.keys(updates).join(","),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Google Ads mutate error: ${res.status} ${await res.text()}`);
    });
  }

  private parseCampaign(row: Record<string, unknown>): CampaignInfo {
    const campaign = (row.campaign ?? row) as Record<string, unknown>;
    return {
      id: String(campaign.id ?? ""),
      name: String(campaign.name ?? ""),
      status: mapGoogleStatus(String(campaign.status ?? "UNKNOWN")),
      dailyBudget: 0, // resolved from budget resource separately
      lifetimeBudget: null,
      deliveryStatus: null,
      startTime: campaign.start_date ? String(campaign.start_date) : null,
      endTime: campaign.end_date ? String(campaign.end_date) : null,
      objective: campaign.advertising_channel_type
        ? String(campaign.advertising_channel_type)
        : null,
    };
  }

  private parseAdGroup(row: Record<string, unknown>): AdSetInfo {
    const adGroup = (row.ad_group ?? row) as Record<string, unknown>;
    return {
      id: String(adGroup.id ?? ""),
      name: String(adGroup.name ?? ""),
      status: mapGoogleStatus(String(adGroup.status ?? "UNKNOWN")),
      dailyBudget: Number(adGroup.cpc_bid_micros ?? 0) / 1_000_000,
      lifetimeBudget: null,
      deliveryStatus: null,
      startTime: null,
      endTime: null,
      targeting: null,
      campaignId: extractIdFromResource(String(adGroup.campaign ?? "")),
    };
  }
}

function mapGoogleStatus(status: string): "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED" {
  switch (status) {
    case "ENABLED":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "DELETED";
    default:
      return "PAUSED";
  }
}

function extractIdFromResource(resource: string): string {
  return resource.split("/").pop() ?? "";
}
