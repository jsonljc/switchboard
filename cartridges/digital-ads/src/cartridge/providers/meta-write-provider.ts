// ---------------------------------------------------------------------------
// MetaAdsWriteProvider — production implementation for write operations
// ---------------------------------------------------------------------------
// Ports the RealMetaAdsProvider pattern from ads-spend with campaign and
// ad set mutation support via the Meta Graph API.
// ---------------------------------------------------------------------------

import type { CampaignInfo, AdSetInfo, ConnectionHealth, MetaAdsWriteProvider } from "../types.js";

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

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      await this.executeWithRetry(`${this.baseUrl}/me?access_token=${this.accessToken}`);
      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
        capabilities: ["campaigns", "adsets", "targeting"],
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

  async healthCheck(): Promise<ConnectionHealth> {
    return {
      status: "connected",
      latencyMs: 5,
      error: null,
      capabilities: ["campaigns", "adsets", "targeting"],
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
