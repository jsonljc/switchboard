import type { ConnectionHealth } from "@switchboard/schemas";
import type { MetaAdsProvider, MetaAdsConfig, CampaignInfo } from "./meta-ads.js";
import { MetaApiError, MetaRateLimitError, MetaAuthError } from "./errors.js";

const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "status",
  "daily_budget",
  "lifetime_budget",
  "effective_status",
  "start_time",
  "end_time",
  "objective",
].join(",");

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface MetaErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface MetaApiCampaign {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status: string;
  start_time?: string;
  end_time?: string;
  objective?: string;
}

interface MetaPagingResponse {
  data: MetaApiCampaign[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

function parseCampaign(raw: MetaApiCampaign): CampaignInfo {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status as CampaignInfo["status"],
    dailyBudget: raw.daily_budget ? Number(raw.daily_budget) : 0,
    lifetimeBudget: raw.lifetime_budget ? Number(raw.lifetime_budget) : null,
    deliveryStatus: raw.effective_status ?? raw.status,
    startTime: raw.start_time ?? new Date().toISOString(),
    endTime: raw.end_time ?? null,
    objective: raw.objective ?? "UNKNOWN",
  };
}

export class RealMetaAdsProvider implements MetaAdsProvider {
  private baseUrl: string;
  private accessToken: string;
  private adAccountId: string;

  constructor(config: MetaAdsConfig) {
    const version = config.apiVersion ?? "v21.0";
    this.baseUrl = `https://graph.facebook.com/${version}`;
    this.accessToken = config.accessToken;
    this.adAccountId = config.adAccountId;
  }

  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    const data = await this.apiRequest<MetaApiCampaign>(
      "GET",
      `/${campaignId}`,
      { fields: CAMPAIGN_FIELDS },
    );
    return parseCampaign(data);
  }

  async searchCampaigns(query: string, adAccountId?: string): Promise<CampaignInfo[]> {
    const accountId = adAccountId ?? this.adAccountId;
    const params: Record<string, string> = { fields: CAMPAIGN_FIELDS };

    if (query) {
      params["filtering"] = JSON.stringify([
        { field: "name", operator: "CONTAIN", value: query },
      ]);
    }

    const prefix = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const firstPage: MetaPagingResponse = await this.apiRequest<MetaPagingResponse>(
      "GET",
      `/${prefix}/campaigns`,
      params,
    );

    const campaigns: CampaignInfo[] = firstPage.data.map(parseCampaign);
    let nextUrl = firstPage.paging?.next ?? null;

    while (nextUrl) {
      const page: MetaPagingResponse = await this.apiRequestAbsolute<MetaPagingResponse>(nextUrl);
      for (const raw of page.data) {
        campaigns.push(parseCampaign(raw));
      }
      nextUrl = page.paging?.next ?? null;
    }

    return campaigns;
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const campaign = await this.getCampaign(campaignId);
    await this.apiRequest("POST", `/${campaignId}`, {}, { status: "PAUSED" });
    return { success: true, previousStatus: campaign.status };
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const campaign = await this.getCampaign(campaignId);
    await this.apiRequest("POST", `/${campaignId}`, {}, { status: "ACTIVE" });
    return { success: true, previousStatus: campaign.status };
  }

  async updateBudget(
    campaignId: string,
    newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const campaign = await this.getCampaign(campaignId);
    const budgetField = campaign.lifetimeBudget !== null ? "lifetime_budget" : "daily_budget";
    await this.apiRequest("POST", `/${campaignId}`, {}, {
      [budgetField]: String(newBudgetCents),
    });
    return { success: true, previousBudget: campaign.dailyBudget };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const start = Date.now();
    try {
      await this.apiRequest("GET", "/me", {});
      return {
        status: "connected",
        latencyMs: Date.now() - start,
        error: null,
        capabilities: [
          "ads.campaign.pause",
          "ads.campaign.resume",
          "ads.budget.adjust",
          "ads.targeting.modify",
        ],
      };
    } catch (err) {
      return {
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Unknown error",
        capabilities: [],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP helpers
  // ---------------------------------------------------------------------------

  private async apiRequest<T>(
    method: string,
    path: string,
    queryParams: Record<string, string> = {},
    body?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("access_token", this.accessToken);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
    return this.executeWithRetry<T>(method, url.toString(), body);
  }

  private async apiRequestAbsolute<T>(absoluteUrl: string): Promise<T> {
    const url = new URL(absoluteUrl);
    if (!url.searchParams.has("access_token")) {
      url.searchParams.set("access_token", this.accessToken);
    }
    return this.executeWithRetry<T>("GET", url.toString());
  }

  private async executeWithRetry<T>(
    method: string,
    url: string,
    body?: Record<string, string>,
    attempt = 0,
  ): Promise<T> {
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body && method === "POST") {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      let parsed: MetaErrorBody | null = null;
      try {
        parsed = JSON.parse(text) as MetaErrorBody;
      } catch {
        // not JSON
      }

      if (parsed?.error) {
        const { message, type, code, error_subcode, fbtrace_id } = parsed.error;
        const subcode = error_subcode ?? 0;

        // Rate limit — retryable
        if (code === 17 && attempt < MAX_RETRIES) {
          await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
          return this.executeWithRetry<T>(method, url, body, attempt + 1);
        }
        if (code === 17) {
          throw new MetaRateLimitError(message, subcode, fbtrace_id);
        }

        // Auth error — not retryable
        if (code === 190) {
          throw new MetaAuthError(message, subcode, fbtrace_id);
        }

        // Other API error — not retryable on 4xx
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
          return this.executeWithRetry<T>(method, url, body, attempt + 1);
        }

        throw new MetaApiError(message, code, subcode, type, fbtrace_id);
      }

      // 5xx without parsed error body — retryable
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
        return this.executeWithRetry<T>(method, url, body, attempt + 1);
      }

      throw new Error(`Meta API HTTP ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
