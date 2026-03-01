import type {
  GoogleAdsApiConfig,
  GoogleAdsError,
  GoogleAdsResponse,
  GoogleAdsRow,
  GoogleOAuth2TokenResponse,
} from "./types.js";
import type {
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  StageMetrics,
  SubEntityBreakdown,
  TimeRange,
} from "../../core/types.js";
import type { PlatformType } from "../types.js";
import { AbstractPlatformClient } from "../base-client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_ADS_API_VERSION = "v16";
const GOOGLE_ADS_BASE_URL = "https://googleads.googleapis.com";
const GOOGLE_OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_MAX_RPS = 10;
const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Rate limiter — simple token-bucket
// ---------------------------------------------------------------------------

class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private maxTokens: number) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    const waitMs = 1000 - (Date.now() - this.lastRefill);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    if (now - this.lastRefill >= 1000) {
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Google Ads API Client
// ---------------------------------------------------------------------------

export class GoogleAdsClient extends AbstractPlatformClient {
  readonly platform: PlatformType = "google";
  private config: Required<Omit<GoogleAdsApiConfig, "loginCustomerId">> & {
    loginCustomerId?: string;
  };
  private rateLimiter: RateLimiter;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: GoogleAdsApiConfig) {
    super();
    this.config = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      developerToken: config.developerToken,
      loginCustomerId: config.loginCustomerId,
      maxRequestsPerSecond: config.maxRequestsPerSecond ?? DEFAULT_MAX_RPS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
    this.rateLimiter = new RateLimiter(this.config.maxRequestsPerSecond);
  }

  // -------------------------------------------------------------------------
  // Public: fetch a normalized MetricSnapshot for a time range
  // -------------------------------------------------------------------------

  async fetchSnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema
  ): Promise<MetricSnapshot> {
    const customerId = entityId.replace(/-/g, "");

    // Build GAQL query for aggregate metrics
    const query = this.buildQuery(entityLevel, timeRange);
    const rows = await this.executeQuery(customerId, query);

    if (rows.length === 0) {
      return this.emptySnapshot(entityId, entityLevel, timeRange, funnel);
    }

    return this.normalizeRows(rows, entityId, entityLevel, timeRange, funnel);
  }

  // -------------------------------------------------------------------------
  // Public: fetch sub-entity breakdowns for structural analysis
  // -------------------------------------------------------------------------

  async fetchSubEntityBreakdowns(
    entityId: string,
    _entityLevel: EntityLevel,
    timeRange: TimeRange,
    _funnel: FunnelSchema
  ): Promise<SubEntityBreakdown[]> {
    const customerId = entityId.replace(/-/g, "");
    const query = `SELECT ad_group.id, ad_group.status, metrics.cost_micros, metrics.conversions FROM ad_group WHERE segments.date BETWEEN '${timeRange.since}' AND '${timeRange.until}' AND ad_group.status = 'ENABLED'`;

    const breakdowns: SubEntityBreakdown[] = [];

    try {
      const rows = await this.executeQuery(customerId, query);

      for (const row of rows) {
        const spend = parseInt(row.metrics?.costMicros ?? "0", 10) / 1_000_000;
        const conversions = row.metrics?.conversions ?? 0;

        breakdowns.push({
          entityId: String(row.adGroup?.id ?? ""),
          entityLevel: "adset", // ad_group maps to adset
          spend,
          conversions,
          daysSinceLastEdit: null, // Not available via Google Ads API easily
          inLearningPhase: false, // No Google equivalent
          dailyBudget: null, // Would need campaign_budget.amount_micros
        });
      }
    } catch {
      // Gracefully return empty on failure
    }

    return breakdowns;
  }

  // -------------------------------------------------------------------------
  // Private: OAuth2 token management
  // -------------------------------------------------------------------------

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
      grant_type: "refresh_token",
    });

    const res = await fetch(GOOGLE_OAUTH2_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OAuth2 token refresh failed: ${res.status} ${text}`);
    }

    const token = (await res.json()) as GoogleOAuth2TokenResponse;
    this.accessToken = token.access_token;
    this.tokenExpiresAt = Date.now() + token.expires_in * 1000;
    return this.accessToken;
  }

  // -------------------------------------------------------------------------
  // Private: GAQL query execution
  // -------------------------------------------------------------------------

  private buildQuery(entityLevel: EntityLevel, timeRange: TimeRange): string {
    const metrics = [
      "metrics.impressions",
      "metrics.clicks",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
      "metrics.all_conversions",
      "metrics.ctr",
      "metrics.average_cpc",
      "metrics.average_cpm",
    ].join(", ");

    let resourceName: string;
    switch (entityLevel) {
      case "campaign":
        resourceName = "campaign";
        break;
      case "adset":
        resourceName = "ad_group";
        break;
      case "ad":
        resourceName = "ad_group_ad";
        break;
      default:
        resourceName = "customer";
        break;
    }

    return `SELECT ${metrics} FROM ${resourceName} WHERE segments.date BETWEEN '${timeRange.since}' AND '${timeRange.until}'`;
  }

  private async executeQuery(
    customerId: string,
    query: string
  ): Promise<GoogleAdsRow[]> {
    const accessToken = await this.ensureAccessToken();
    const url = `${GOOGLE_ADS_BASE_URL}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;

    const allRows: GoogleAdsRow[] = [];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      await this.rateLimiter.acquire();

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": this.config.developerToken,
          "Content-Type": "application/json",
        };
        if (this.config.loginCustomerId) {
          headers["login-customer-id"] = this.config.loginCustomerId;
        }

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ query }),
        });

        if (res.ok) {
          // searchStream returns an array of response batches
          const batches = (await res.json()) as GoogleAdsResponse[];
          for (const batch of batches) {
            allRows.push(...batch.results);
          }
          return allRows;
        }

        const body = (await res.json()) as GoogleAdsError;
        const status = body.error?.status;

        // Retry on UNAVAILABLE and RESOURCE_EXHAUSTED
        if (
          (status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED") &&
          attempt < this.config.maxRetries
        ) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        throw new Error(
          `Google Ads API error ${body.error?.code}: ${body.error?.message ?? res.statusText}`
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }
    }

    throw lastError ?? new Error("Google Ads request failed after retries");
  }

  // -------------------------------------------------------------------------
  // Private: normalization — Google Ads rows → MetricSnapshot
  // -------------------------------------------------------------------------

  private normalizeRows(
    rows: GoogleAdsRow[],
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema
  ): MetricSnapshot {
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;
    let totalConversionsValue = 0;
    let totalAllConversions = 0;

    for (const row of rows) {
      const m = row.metrics;
      totalImpressions += parseInt(m.impressions ?? "0", 10);
      totalClicks += parseInt(m.clicks ?? "0", 10);
      // Google reports cost in micros (1/1,000,000 of currency unit)
      totalSpend += parseInt(m.costMicros ?? "0", 10) / 1_000_000;
      totalConversions += m.conversions ?? 0;
      totalConversionsValue += m.conversionsValue ?? 0;
      totalAllConversions += m.allConversions ?? 0;
    }

    // Build stage metrics from the funnel schema
    const stages: Record<string, StageMetrics> = {};

    for (const stage of funnel.stages) {
      let count: number;
      if (stage.metric === "impressions") {
        count = totalImpressions;
      } else if (stage.metric === "clicks") {
        count = totalClicks;
      } else if (stage.metric === "conversions") {
        count = totalConversions;
      } else if (stage.metric === "all_conversions") {
        count = totalAllConversions;
      } else {
        count = 0;
      }

      let cost: number | null = null;
      if (stage.costMetric === "cpm" && totalImpressions > 0) {
        cost = (totalSpend / totalImpressions) * 1000;
      } else if (stage.costMetric === "cpc" && totalClicks > 0) {
        cost = totalSpend / totalClicks;
      } else if (stage.costMetric === "cost_per_conversion" && totalConversions > 0) {
        cost = totalSpend / totalConversions;
      }

      stages[stage.metric] = { count, cost };
    }

    // Top-level fields
    const topLevel: Record<string, number> = {
      impressions: totalImpressions,
      clicks: totalClicks,
      spend: totalSpend,
      conversions: totalConversions,
      conversions_value: totalConversionsValue,
    };

    if (totalImpressions > 0) {
      topLevel.cpm = (totalSpend / totalImpressions) * 1000;
      topLevel.ctr = (totalClicks / totalImpressions) * 100;
    }
    if (totalClicks > 0) {
      topLevel.cpc = totalSpend / totalClicks;
    }
    if (totalConversions > 0) {
      topLevel.cost_per_conversion = totalSpend / totalConversions;
    }
    if (totalSpend > 0 && totalConversionsValue > 0) {
      topLevel.roas = totalConversionsValue / totalSpend;
    }

    return {
      entityId,
      entityLevel,
      periodStart: timeRange.since,
      periodEnd: timeRange.until,
      spend: totalSpend,
      stages,
      topLevel,
    };
  }

  private emptySnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema
  ): MetricSnapshot {
    const stages: Record<string, StageMetrics> = {};
    for (const stage of funnel.stages) {
      stages[stage.metric] = { count: 0, cost: null };
    }
    return {
      entityId,
      entityLevel,
      periodStart: timeRange.since,
      periodEnd: timeRange.until,
      spend: 0,
      stages,
      topLevel: {},
    };
  }
}
