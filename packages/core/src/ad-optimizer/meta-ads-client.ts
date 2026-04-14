// packages/core/src/ad-optimizer/meta-ads-client.ts
import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetInsightSchema as AdSetInsight,
  AccountSummarySchema as AccountSummary,
} from "@switchboard/schemas";

const API_BASE = "https://graph.facebook.com/v21.0";
const RATE_LIMIT_MS = 60_000;

interface MetaAdsClientConfig {
  accessToken: string;
  accountId: string;
}

interface DateRange {
  since: string;
  until: string;
}

interface CampaignInsightsParams {
  dateRange: DateRange;
  fields: string[];
  breakdowns?: string[];
}

interface AdSetInsightsParams {
  dateRange: DateRange;
  fields: string[];
  campaignId?: string;
}

interface DraftCampaignParams {
  name: string;
  objective: string;
  budget: { daily: number } | { lifetime: number };
  bidStrategy: string;
}

interface DraftAdSetParams {
  campaignId: string;
  name: string;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
}

interface UploadCreativeAssetParams {
  file: Buffer;
  type: "image" | "video";
}

type CampaignStatus = "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
  };
}

export class MetaAdsClient {
  private readonly accessToken: string;
  private readonly accountId: string;
  private lastCallAt: number = 0;

  constructor(config: MetaAdsClientConfig) {
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;
  }

  async getCampaignInsights(params: CampaignInsightsParams): Promise<CampaignInsight[]> {
    const queryParams = new URLSearchParams({
      level: "campaign",
      time_range: JSON.stringify(params.dateRange),
      fields: params.fields.join(","),
    });

    if (params.breakdowns) {
      queryParams.set("breakdowns", params.breakdowns.join(","));
    }

    const response = await this.get(`/${this.accountId}/insights?${queryParams.toString()}`);
    const data = response.data as Record<string, string>[];
    return data.map((raw) => this.mapCampaignInsight(raw));
  }

  async getAdSetInsights(params: AdSetInsightsParams): Promise<AdSetInsight[]> {
    const queryParams = new URLSearchParams({
      level: "adset",
      time_range: JSON.stringify(params.dateRange),
      fields: params.fields.join(","),
    });

    if (params.campaignId) {
      queryParams.set(
        "filtering",
        JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: params.campaignId }]),
      );
    }

    const response = await this.get(`/${this.accountId}/insights?${queryParams.toString()}`);
    const data = response.data as Record<string, string>[];
    return data.map((raw) => this.mapAdSetInsight(raw));
  }

  async getAccountSummary(): Promise<AccountSummary> {
    const metadata = await this.get(`/${this.accountId}`);
    const insightsResponse = await this.get(`/${this.accountId}/insights`);
    const campaignsResponse = await this.get(
      `/${this.accountId}/campaigns?effective_status=["ACTIVE"]`,
    );

    const insights = (insightsResponse.data as Record<string, string>[])?.[0] ?? {};
    const activeCampaigns = (campaignsResponse.data as unknown[])?.length ?? 0;

    return {
      accountId: metadata.id as string,
      accountName: metadata.name as string,
      currency: metadata.currency as string,
      totalSpend: parseFloat(insights.spend ?? "0"),
      totalImpressions: parseInt(insights.impressions ?? "0", 10),
      totalClicks: parseInt(insights.clicks ?? "0", 10),
      activeCampaigns,
    };
  }

  async createDraftCampaign(params: DraftCampaignParams): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: params.name,
      objective: params.objective,
      status: "PAUSED",
      bid_strategy: params.bidStrategy,
    };

    if ("daily" in params.budget) {
      body.daily_budget = params.budget.daily;
    } else {
      body.lifetime_budget = params.budget.lifetime;
    }

    const response = await this.post(`/${this.accountId}/campaigns`, body);
    return { id: response.id as string };
  }

  async createDraftAdSet(params: DraftAdSetParams): Promise<{ id: string }> {
    const body = {
      campaign_id: params.campaignId,
      name: params.name,
      targeting: params.targeting,
      optimization_goal: params.optimizationGoal,
      status: "PAUSED",
    };

    const response = await this.post(`/${this.accountId}/adsets`, body);
    return { id: response.id as string };
  }

  async uploadCreativeAsset(
    params: UploadCreativeAssetParams,
  ): Promise<{ id: string; url: string }> {
    const endpoint =
      params.type === "image" ? `/${this.accountId}/adimages` : `/${this.accountId}/advideos`;

    const response = await this.post(endpoint, {
      file: params.file.toString("base64"),
      type: params.type,
    });

    return { id: response.id as string, url: response.url as string };
  }

  async updateCampaignStatus(campaignId: string, status: CampaignStatus): Promise<void> {
    if (status === "ACTIVE") {
      throw new Error(
        "SAFETY: Agent cannot activate campaigns. Human must publish via Ads Manager.",
      );
    }

    await this.post(`/${campaignId}`, { status });
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    await this.rateLimit();
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return this.handleResponse(response);
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.rateLimit();
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse(response);
  }

  private async handleResponse(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) {
      let message = "Unknown error";
      try {
        const errorBody = (await response.json()) as MetaApiError;
        if (errorBody.error?.message) {
          message = errorBody.error.message;
        }
      } catch {
        // JSON parsing failed, use default message
      }
      throw new Error(`Meta API error (${response.status}): ${message}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    if (this.lastCallAt > 0 && elapsed < RATE_LIMIT_MS) {
      const waitTime = RATE_LIMIT_MS - elapsed;
      await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastCallAt = Date.now();
  }

  private mapCampaignInsight(raw: Record<string, string>): CampaignInsight {
    return {
      campaignId: raw.campaign_id ?? "",
      campaignName: raw.campaign_name ?? "",
      status: raw.status ?? "",
      effectiveStatus: raw.effective_status ?? "",
      impressions: parseInt(raw.impressions ?? "0", 10),
      clicks: parseInt(raw.clicks ?? "0", 10),
      spend: parseFloat(raw.spend ?? "0"),
      conversions: parseInt(raw.conversions ?? "0", 10),
      revenue: parseFloat(raw.revenue ?? "0"),
      frequency: parseFloat(raw.frequency ?? "0"),
      cpm: parseFloat(raw.cpm ?? "0"),
      ctr: parseFloat(raw.ctr ?? "0"),
      cpc: parseFloat(raw.cpc ?? "0"),
      dateStart: raw.date_start ?? "",
      dateStop: raw.date_stop ?? "",
    };
  }

  private mapAdSetInsight(raw: Record<string, string>): AdSetInsight {
    return {
      adSetId: raw.adset_id ?? "",
      adSetName: raw.adset_name ?? "",
      campaignId: raw.campaign_id ?? "",
      impressions: parseInt(raw.impressions ?? "0", 10),
      clicks: parseInt(raw.clicks ?? "0", 10),
      spend: parseFloat(raw.spend ?? "0"),
      conversions: parseInt(raw.conversions ?? "0", 10),
      frequency: parseFloat(raw.frequency ?? "0"),
      cpm: parseFloat(raw.cpm ?? "0"),
      ctr: parseFloat(raw.ctr ?? "0"),
      cpc: parseFloat(raw.cpc ?? "0"),
      dateStart: raw.date_start ?? "",
      dateStop: raw.date_stop ?? "",
    };
  }
}
