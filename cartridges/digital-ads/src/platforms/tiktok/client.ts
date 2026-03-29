import type { TikTokApiConfig, TikTokReportResponse, TikTokReportRow } from "./types.js";
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

interface TikTokAggregates {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalPageBrowse: number;
  totalAddToCart: number;
  totalPurchase: number;
  totalPurchaseValue: number;
  totalConversion: number;
  totalFormSubmit: number;
  totalOnsiteForm: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const DEFAULT_MAX_RPS = 10;
const DEFAULT_MAX_RETRIES = 3;

// Standard metrics to request
const REPORT_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "page_browse",
  "onsite_add_to_cart",
  "complete_payment",
  "complete_payment_value",
  "cost_per_complete_payment",
  "conversion",
  "cost_per_conversion",
  "form_submit",
  "cost_per_form_submit",
  "onsite_form",
  "cost_per_onsite_form",
  "complete_payment_roas",
];

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
// TikTok Ads API Client
// ---------------------------------------------------------------------------

export class TikTokAdsClient extends AbstractPlatformClient {
  readonly platform: PlatformType = "tiktok";
  private config: Required<TikTokApiConfig>;
  private rateLimiter: RateLimiter;

  constructor(config: TikTokApiConfig) {
    super();
    this.config = {
      accessToken: config.accessToken,
      appId: config.appId,
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
    funnel: FunnelSchema,
  ): Promise<MetricSnapshot> {
    const rows = await this.fetchReport(entityId, entityLevel, timeRange);

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
    _funnel: FunnelSchema,
  ): Promise<SubEntityBreakdown[]> {
    const requestBody = {
      advertiser_id: entityId,
      report_type: "BASIC",
      data_level: "AUCTION_ADGROUP",
      dimensions: ["adgroup_id"],
      metrics: ["spend", "conversion", "complete_payment"],
      start_date: timeRange.since,
      end_date: timeRange.until,
      page: 1,
      page_size: 1000,
    };

    const breakdowns: SubEntityBreakdown[] = [];

    try {
      const response = await this.requestWithRetry(requestBody);

      for (const row of response.data.list) {
        const spend = parseFloat(row.metrics.spend ?? "0");
        const conversions =
          parseInt(row.metrics.complete_payment ?? "0", 10) +
          parseInt(row.metrics.conversion ?? "0", 10);

        breakdowns.push({
          entityId: row.dimensions.adgroup_id ?? "",
          entityLevel: "adset", // adgroup maps to adset
          spend,
          conversions,
          daysSinceLastEdit: null,
          inLearningPhase: false, // Would need separate adgroup GET call
          dailyBudget: null, // Would need separate adgroup GET call
        });
      }
    } catch {
      // Gracefully return empty on failure
    }

    return breakdowns;
  }

  // -------------------------------------------------------------------------
  // Private: TikTok Reporting API calls
  // -------------------------------------------------------------------------

  private getReportDataLevel(entityLevel: EntityLevel): string {
    switch (entityLevel) {
      case "campaign":
        return "AUCTION_CAMPAIGN";
      case "adset":
        return "AUCTION_ADGROUP";
      case "ad":
        return "AUCTION_AD";
      default:
        return "AUCTION_ADVERTISER";
    }
  }

  private async fetchReport(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
  ): Promise<TikTokReportRow[]> {
    const dataLevel = this.getReportDataLevel(entityLevel);

    const requestBody = {
      advertiser_id: entityId,
      report_type: "BASIC",
      data_level: dataLevel,
      dimensions: ["stat_time_day"],
      metrics: REPORT_METRICS,
      start_date: timeRange.since,
      end_date: timeRange.until,
      page: 1,
      page_size: 1000,
    };

    const allRows: TikTokReportRow[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      requestBody.page = page;
      const response = await this.requestWithRetry(requestBody);

      allRows.push(...response.data.list);

      const pageInfo = response.data.page_info;
      if (pageInfo && page < pageInfo.total_page) {
        page++;
      } else {
        hasMore = false;
      }
    }

    return allRows;
  }

  private async requestWithRetry(body: Record<string, unknown>): Promise<TikTokReportResponse> {
    const url = `${TIKTOK_API_BASE}/report/integrated/get/`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      await this.rateLimiter.acquire();

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Access-Token": this.config.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`TikTok API HTTP error ${res.status}: ${text}`);
        }

        const data = (await res.json()) as TikTokReportResponse;

        // TikTok uses code 0 for success
        if (data.code === 0) {
          return data;
        }

        // Retry on rate limiting (code 40100) and transient errors
        if ((data.code === 40100 || data.code >= 50000) && attempt < this.config.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        throw new Error(`TikTok API error ${data.code}: ${data.message}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }
    }

    throw lastError ?? new Error("TikTok API request failed after retries");
  }

  // -------------------------------------------------------------------------
  // Private: normalization — TikTok report rows → MetricSnapshot
  // -------------------------------------------------------------------------

  private normalizeRows(
    rows: TikTokReportRow[],
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
  ): MetricSnapshot {
    const aggregates = this.aggregateTikTokMetrics(rows);
    const stages = this.buildTikTokStages(funnel, aggregates);
    const topLevel = this.buildTikTokTopLevel(aggregates);

    return {
      entityId,
      entityLevel,
      periodStart: timeRange.since,
      periodEnd: timeRange.until,
      spend: aggregates.totalSpend,
      stages,
      topLevel,
    };
  }

  private aggregateTikTokMetrics(rows: TikTokReportRow[]): TikTokAggregates {
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalPageBrowse = 0;
    let totalAddToCart = 0;
    let totalPurchase = 0;
    let totalPurchaseValue = 0;
    let totalConversion = 0;
    let totalFormSubmit = 0;
    let totalOnsiteForm = 0;

    for (const row of rows) {
      const m = row.metrics;
      totalSpend += parseFloat(m.spend ?? "0");
      totalImpressions += parseInt(m.impressions ?? "0", 10);
      totalClicks += parseInt(m.clicks ?? "0", 10);
      totalPageBrowse += parseInt(m.page_browse ?? "0", 10);
      totalAddToCart += parseInt(m.onsite_add_to_cart ?? "0", 10);
      totalPurchase += parseInt(m.complete_payment ?? "0", 10);
      totalPurchaseValue += parseFloat(m.complete_payment_value ?? "0");
      totalConversion += parseInt(m.conversion ?? "0", 10);
      totalFormSubmit += parseInt(m.form_submit ?? "0", 10);
      totalOnsiteForm += parseInt(m.onsite_form ?? "0", 10);
    }

    return {
      totalSpend,
      totalImpressions,
      totalClicks,
      totalPageBrowse,
      totalAddToCart,
      totalPurchase,
      totalPurchaseValue,
      totalConversion,
      totalFormSubmit,
      totalOnsiteForm,
    };
  }

  private buildTikTokStages(
    funnel: FunnelSchema,
    aggregates: TikTokAggregates,
  ): Record<string, StageMetrics> {
    const metricMap: Record<string, number> = {
      impressions: aggregates.totalImpressions,
      clicks: aggregates.totalClicks,
      page_browse: aggregates.totalPageBrowse,
      onsite_add_to_cart: aggregates.totalAddToCart,
      complete_payment: aggregates.totalPurchase,
      conversion: aggregates.totalConversion,
      form_submit: aggregates.totalFormSubmit,
      onsite_form: aggregates.totalOnsiteForm,
    };

    const stages: Record<string, StageMetrics> = {};

    for (const stage of funnel.stages) {
      const count = metricMap[stage.metric] ?? 0;
      const cost = this.getTikTokStageCost(stage.costMetric, aggregates, count);
      stages[stage.metric] = { count, cost };
    }

    return stages;
  }

  private getTikTokStageCost(
    costMetric: string | null | undefined,
    aggregates: TikTokAggregates,
    count: number,
  ): number | null {
    if (!costMetric) return null;

    if (costMetric === "cpm" && aggregates.totalImpressions > 0) {
      return (aggregates.totalSpend / aggregates.totalImpressions) * 1000;
    }
    if (costMetric === "cpc" && aggregates.totalClicks > 0) {
      return aggregates.totalSpend / aggregates.totalClicks;
    }
    if (count > 0) {
      return aggregates.totalSpend / count;
    }

    return null;
  }

  private buildTikTokTopLevel(aggregates: TikTokAggregates): Record<string, number> {
    const topLevel: Record<string, number> = {
      impressions: aggregates.totalImpressions,
      clicks: aggregates.totalClicks,
      spend: aggregates.totalSpend,
      page_browse: aggregates.totalPageBrowse,
      onsite_add_to_cart: aggregates.totalAddToCart,
      complete_payment: aggregates.totalPurchase,
      complete_payment_value: aggregates.totalPurchaseValue,
      conversion: aggregates.totalConversion,
      form_submit: aggregates.totalFormSubmit,
    };

    if (aggregates.totalImpressions > 0) {
      topLevel.cpm = (aggregates.totalSpend / aggregates.totalImpressions) * 1000;
      topLevel.ctr = (aggregates.totalClicks / aggregates.totalImpressions) * 100;
    }
    if (aggregates.totalClicks > 0) {
      topLevel.cpc = aggregates.totalSpend / aggregates.totalClicks;
    }
    if (aggregates.totalPurchase > 0) {
      topLevel.cost_per_complete_payment = aggregates.totalSpend / aggregates.totalPurchase;
    }
    if (aggregates.totalSpend > 0 && aggregates.totalPurchaseValue > 0) {
      topLevel.roas = aggregates.totalPurchaseValue / aggregates.totalSpend;
    }

    return topLevel;
  }

  private emptySnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
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
