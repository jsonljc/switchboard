// ---------------------------------------------------------------------------
// Meta Ads Provider
// ---------------------------------------------------------------------------

import type { PlatformClient, PlatformCredentials } from "../../platforms/types.js";
import type { EntityLevel } from "../../core/types.js";
import type { PlatformHealth } from "../types.js";
import type { AdPlatformProvider } from "./provider.js";
import { MetaApiClient } from "../../platforms/meta/client.js";
import { todayISO } from "../utils.js";

export class MetaProvider implements AdPlatformProvider {
  readonly platform = "meta" as const;

  async connect(
    credentials: PlatformCredentials,
    entityId: string
  ): Promise<{
    client: PlatformClient;
    accountName: string;
    entityLevels: EntityLevel[];
  }> {
    if (credentials.platform !== "meta") {
      throw new Error("MetaProvider requires Meta credentials");
    }
    const client = new MetaApiClient({ accessToken: credentials.accessToken });

    // Validate by fetching a lightweight snapshot — confirms the token works
    const timeRange = { since: todayISO(), until: todayISO() };
    const minimalFunnel = {
      vertical: "commerce" as const,
      stages: [
        {
          name: "awareness",
          metric: "impressions",
          metricSource: "top_level",
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
      entityLevels: ["account", "campaign", "adset", "ad"],
    };
  }

  async checkHealth(
    credentials: PlatformCredentials,
    entityId: string
  ): Promise<PlatformHealth> {
    const start = Date.now();
    try {
      await this.connect(credentials, entityId);
      return {
        platform: "meta",
        status: "connected",
        latencyMs: Date.now() - start,
        capabilities: ["meta-commerce", "meta-leadgen", "meta-brand"],
      };
    } catch (err) {
      return {
        platform: "meta",
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        capabilities: [],
      };
    }
  }

  createClient(credentials: PlatformCredentials): PlatformClient {
    if (credentials.platform !== "meta") {
      throw new Error("MetaProvider requires Meta credentials");
    }
    return new MetaApiClient({ accessToken: credentials.accessToken });
  }
}
