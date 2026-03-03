// ---------------------------------------------------------------------------
// Google Ads Provider
// ---------------------------------------------------------------------------

import type { PlatformClient, PlatformCredentials } from "../../platforms/types.js";
import type { EntityLevel } from "../../core/types.js";
import type { PlatformHealth } from "../types.js";
import type { AdPlatformProvider } from "./provider.js";
import { GoogleAdsClient } from "../../platforms/google/client.js";
import { todayISO } from "../utils.js";

export class GoogleProvider implements AdPlatformProvider {
  readonly platform = "google" as const;

  async connect(
    credentials: PlatformCredentials,
    entityId: string,
  ): Promise<{
    client: PlatformClient;
    accountName: string;
    entityLevels: EntityLevel[];
  }> {
    if (credentials.platform !== "google") {
      throw new Error("GoogleProvider requires Google credentials");
    }
    const client = new GoogleAdsClient({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      developerToken: credentials.developerToken,
      loginCustomerId: credentials.loginCustomerId,
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
      entityLevels: ["account", "campaign"],
    };
  }

  async checkHealth(credentials: PlatformCredentials, entityId: string): Promise<PlatformHealth> {
    const start = Date.now();
    try {
      await this.connect(credentials, entityId);
      return {
        platform: "google",
        status: "connected",
        latencyMs: Date.now() - start,
        capabilities: ["google-commerce", "google-leadgen", "google-brand"],
      };
    } catch (err) {
      return {
        platform: "google",
        status: "disconnected",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        capabilities: [],
      };
    }
  }

  createClient(credentials: PlatformCredentials): PlatformClient {
    if (credentials.platform !== "google") {
      throw new Error("GoogleProvider requires Google credentials");
    }
    return new GoogleAdsClient({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      developerToken: credentials.developerToken,
      loginCustomerId: credentials.loginCustomerId,
    });
  }
}
