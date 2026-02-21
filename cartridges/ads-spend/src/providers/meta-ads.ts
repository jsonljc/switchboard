import type { ConnectionHealth } from "@switchboard/schemas";

export interface MetaAdsConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion?: string;
}

export interface CampaignInfo {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudget: number;
  lifetimeBudget: number | null;
  deliveryStatus: string;
  startTime: string;
  endTime: string | null;
  objective: string;
}

export class MetaAdsProvider {
  private config: MetaAdsConfig;

  constructor(config: MetaAdsConfig) {
    this.config = config;
  }

  async getCampaign(campaignId: string): Promise<CampaignInfo> {
    // In production, this would call the Meta Marketing API
    // For now, return a mock that can be replaced with real API calls
    return {
      id: campaignId,
      name: `Campaign ${campaignId}`,
      status: "ACTIVE",
      dailyBudget: 5000, // cents
      lifetimeBudget: null,
      deliveryStatus: "ACTIVE",
      startTime: new Date().toISOString(),
      endTime: null,
      objective: "CONVERSIONS",
    };
  }

  async searchCampaigns(
    _query: string,
    adAccountId?: string,
  ): Promise<CampaignInfo[]> {
    // In production, this would search via the Marketing API
    const accountId = adAccountId ?? this.config.adAccountId;
    return [
      {
        id: `${accountId}_1`,
        name: `Summer Sale 2026 - US`,
        status: "ACTIVE",
        dailyBudget: 50000,
        lifetimeBudget: null,
        deliveryStatus: "ACTIVE",
        startTime: new Date().toISOString(),
        endTime: null,
        objective: "CONVERSIONS",
      },
      {
        id: `${accountId}_2`,
        name: `Brand Awareness Q1`,
        status: "ACTIVE",
        dailyBudget: 30000,
        lifetimeBudget: null,
        deliveryStatus: "LEARNING",
        startTime: new Date().toISOString(),
        endTime: null,
        objective: "BRAND_AWARENESS",
      },
    ];
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    const campaign = await this.getCampaign(campaignId);
    // In production: POST to /{campaignId}?status=PAUSED
    return { success: true, previousStatus: campaign.status };
  }

  async resumeCampaign(_campaignId: string): Promise<{ success: boolean; previousStatus: string }> {
    // In production: POST to /{campaignId}?status=ACTIVE
    return { success: true, previousStatus: "PAUSED" };
  }

  async updateBudget(
    campaignId: string,
    _newBudgetCents: number,
  ): Promise<{ success: boolean; previousBudget: number }> {
    const campaign = await this.getCampaign(campaignId);
    // In production: POST to /{campaignId}?daily_budget={newBudgetCents}
    return { success: true, previousBudget: campaign.dailyBudget };
  }

  async healthCheck(): Promise<ConnectionHealth> {
    try {
      // In production, would call /me endpoint
      return {
        status: "connected",
        latencyMs: 50,
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
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Unknown error",
        capabilities: [],
      };
    }
  }
}
