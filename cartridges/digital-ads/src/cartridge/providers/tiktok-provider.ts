// ---------------------------------------------------------------------------
// TikTok Ads Provider
// ---------------------------------------------------------------------------

import type { PlatformClient, PlatformCredentials } from "../../platforms/types.js";
import type { EntityLevel } from "../../core/types.js";
import type { PlatformHealth } from "../types.js";
import type { AdPlatformProvider } from "./provider.js";
import { TikTokAdsClient } from "../../platforms/tiktok/client.js";
import { todayISO } from "../utils.js";

export class TikTokProvider implements AdPlatformProvider {
  readonly platform = "tiktok" as const;

  async connect(
    credentials: PlatformCredentials,
    entityId: string,
  ): Promise<{
    client: PlatformClient;
    accountName: string;
    entityLevels: EntityLevel[];
  }> {
    if (credentials.platform !== "tiktok") {
      throw new Error("TikTokProvider requires TikTok credentials");
    }
    const client = new TikTokAdsClient({
      accessToken: credentials.accessToken,
      appId: credentials.appId,
    });

    // Validate by fetching a lightweight snapshot
    const timeRange = { since: todayISO(), until: todayISO() };
    const minimalFunnel = {
      vertical: "commerce" as const,
      stages: [
        {
          name: "awareness",
          metric: "impressions",
          metricSource: "metrics",
          costMetric: null,
          costMetricSource: null,
        },
      ],
      primaryKPI: "impressions",
      roasMetric: null,
    };

    await client.fetchSnapshot(entityId, "account", timeRange, minimalFunnel);

    return {
      client,
      accountName: entityId,
      entityLevels: ["account", "campaign", "adset"],
    };
  }

  async checkHealth(credentials: PlatformCredentials, entityId: string): Promise<PlatformHealth> {
    const start = Date.now();
    try {
      await this.connect(credentials, entityId);
      return {
        platform: "tiktok",
        status: "connected",
        latencyMs: Date.now() - start,
        capabilities: ["tiktok-commerce", "tiktok-leadgen", "tiktok-brand"],
      };
    } catch (err) {
      return {
        platform: "tiktok",
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        capabilities: [],
      };
    }
  }

  createClient(credentials: PlatformCredentials): PlatformClient {
    if (credentials.platform !== "tiktok") {
      throw new Error("TikTokProvider requires TikTok credentials");
    }
    return new TikTokAdsClient({
      accessToken: credentials.accessToken,
      appId: credentials.appId,
    });
  }
}
