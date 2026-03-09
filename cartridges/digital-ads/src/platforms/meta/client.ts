import type { MetaApiConfig, MetaInsightsRow } from "./types.js";
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
import { MetaGraphClient } from "./graph-client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// All the fields we need from the insights endpoint
const INSIGHTS_FIELDS = [
  "spend",
  "impressions",
  "inline_link_clicks",
  "clicks",
  "cpc",
  "cpm",
  "ctr",
  "frequency",
  "actions",
  "cost_per_action_type",
  "action_values",
  "website_purchase_roas",
].join(",");

// ---------------------------------------------------------------------------
// Meta API Client config with optional shared graph client
// ---------------------------------------------------------------------------

export interface MetaApiClientConfig extends MetaApiConfig {
  graphClient?: MetaGraphClient;
}

// ---------------------------------------------------------------------------
// Meta API Client
// ---------------------------------------------------------------------------

export class MetaApiClient extends AbstractPlatformClient {
  readonly platform: PlatformType = "meta";
  private client: MetaGraphClient;

  constructor(config: MetaApiClientConfig) {
    super();
    this.client =
      config.graphClient ??
      new MetaGraphClient({
        accessToken: config.accessToken,
        apiVersion: config.apiVersion,
        maxRequestsPerSecond: config.maxRequestsPerSecond,
        maxRetries: config.maxRetries,
      });
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
    const rows = await this.fetchInsights(entityId, entityLevel, timeRange);

    if (rows.length === 0) {
      return this.emptySnapshot(entityId, entityLevel, timeRange, funnel);
    }

    // Aggregate all rows in the period (there may be multiple if breakdowns exist)
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
    const breakdowns: SubEntityBreakdown[] = [];

    try {
      const data = await this.client.request<{
        data: Array<{
          id: string;
          status: string;
          effective_status: string;
          daily_budget?: string;
          insights?: {
            data: Array<{
              spend: string;
              actions?: Array<{ action_type: string; value: string }>;
            }>;
          };
        }>;
      }>(`${entityId}/adsets`, {
        params: {
          fields: [
            "id",
            "status",
            "effective_status",
            "daily_budget",
            `insights.time_range(${JSON.stringify({ since: timeRange.since, until: timeRange.until })})` +
              "{spend,actions}",
          ].join(","),
          limit: "500",
        },
      });

      for (const adset of data.data) {
        if (adset.effective_status !== "ACTIVE") continue;

        const insightsRow = adset.insights?.data?.[0];
        const spend = parseFloat(insightsRow?.spend ?? "0");
        const conversions =
          insightsRow?.actions?.reduce((sum, a) => {
            if (
              a.action_type === "purchase" ||
              a.action_type === "lead" ||
              a.action_type === "complete_registration"
            ) {
              return sum + parseInt(a.value, 10);
            }
            return sum;
          }, 0) ?? 0;

        breakdowns.push({
          entityId: adset.id,
          entityLevel: "adset",
          spend,
          conversions,
          daysSinceLastEdit: null, // Would need activities API call
          inLearningPhase: false, // Would need learning_stage_info field
          dailyBudget: adset.daily_budget ? parseFloat(adset.daily_budget) / 100 : null,
        });
      }
    } catch {
      // Gracefully return empty on failure
    }

    return breakdowns;
  }

  // -------------------------------------------------------------------------
  // Private: raw API call via MetaGraphClient
  // -------------------------------------------------------------------------

  private async fetchInsights(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
  ): Promise<MetaInsightsRow[]> {
    const endpoint = this.getEndpoint(entityId, entityLevel);

    return this.client.requestPaginated<MetaInsightsRow>(endpoint, {
      fields: INSIGHTS_FIELDS,
      time_range: JSON.stringify({
        since: timeRange.since,
        until: timeRange.until,
      }),
      limit: "500",
    });
  }

  // -------------------------------------------------------------------------
  // Private: normalization — raw API rows → MetricSnapshot
  // -------------------------------------------------------------------------

  private normalizeRows(
    rows: MetaInsightsRow[],
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
  ): MetricSnapshot {
    // Aggregate across rows
    let totalSpend = 0;
    const actionTotals: Record<string, number> = {};
    const costTotals: Record<string, { total: number; count: number }> = {};
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalInlineClicks = 0;
    let weightedFrequency = 0;

    for (const row of rows) {
      totalSpend += parseFloat(row.spend || "0");
      totalImpressions += parseInt(row.impressions || "0", 10);
      totalClicks += parseInt(row.clicks || "0", 10);
      totalInlineClicks += parseInt(row.inline_link_clicks || "0", 10);

      // Frequency is impression-weighted across rows
      const rowImpressions = parseInt(row.impressions || "0", 10);
      const rowFrequency = parseFloat(row.frequency || "0");
      weightedFrequency += rowFrequency * rowImpressions;

      for (const action of row.actions ?? []) {
        actionTotals[action.action_type] =
          (actionTotals[action.action_type] ?? 0) + parseInt(action.value, 10);
      }

      for (const costAction of row.cost_per_action_type ?? []) {
        const entry = costTotals[costAction.action_type] ?? {
          total: 0,
          count: 0,
        };
        entry.total += parseFloat(costAction.value);
        entry.count += 1;
        costTotals[costAction.action_type] = entry;
      }
    }

    // Build stage metrics from the funnel schema
    const stages: Record<string, StageMetrics> = {};

    for (const stage of funnel.stages) {
      let count: number;
      if (stage.metricSource === "top_level") {
        if (stage.metric === "impressions") count = totalImpressions;
        else if (stage.metric === "inline_link_clicks") count = totalInlineClicks;
        else if (stage.metric === "clicks") count = totalClicks;
        else count = 0;
      } else {
        count = actionTotals[stage.metric] ?? 0;
      }

      let cost: number | null = null;
      if (stage.costMetric && stage.costMetricSource === "top_level") {
        // For top-level cost metrics, compute from aggregates
        if (stage.costMetric === "cpm" && totalImpressions > 0) {
          cost = (totalSpend / totalImpressions) * 1000;
        } else if (stage.costMetric === "cpc" && totalInlineClicks > 0) {
          cost = totalSpend / totalInlineClicks;
        }
      } else if (stage.costMetric && stage.costMetricSource === "cost_per_action_type") {
        // Compute cost per action from spend / action count
        if (count > 0) {
          cost = totalSpend / count;
        }
      }

      stages[stage.metric] = { count, cost };
    }

    // Aggregate action_values (revenue data) and ROAS
    const actionValueTotals: Record<string, number> = {};
    const roasTotals: Record<string, { total: number; count: number }> = {};

    for (const row of rows) {
      for (const av of row.action_values ?? []) {
        actionValueTotals[av.action_type] =
          (actionValueTotals[av.action_type] ?? 0) + parseFloat(av.value);
      }
      for (const roas of row.website_purchase_roas ?? []) {
        const entry = roasTotals[roas.action_type] ?? { total: 0, count: 0 };
        entry.total += parseFloat(roas.value);
        entry.count += 1;
        roasTotals[roas.action_type] = entry;
      }
    }

    // Top-level fields
    const topLevel: Record<string, number> = {
      impressions: totalImpressions,
      clicks: totalClicks,
      inline_link_clicks: totalInlineClicks,
      spend: totalSpend,
    };

    if (totalImpressions > 0) {
      topLevel.cpm = (totalSpend / totalImpressions) * 1000;
      topLevel.ctr = (totalInlineClicks / totalImpressions) * 100;
    }
    if (totalInlineClicks > 0) {
      topLevel.cpc = totalSpend / totalInlineClicks;
    }
    if (totalImpressions > 0 && weightedFrequency > 0) {
      topLevel.frequency = weightedFrequency / totalImpressions;
    }

    // Revenue-related fields from action_values
    for (const [actionType, value] of Object.entries(actionValueTotals)) {
      // Map common action_value types to recognizable topLevel keys
      if (actionType === "offsite_conversion.fb_pixel_purchase") {
        topLevel.purchase_value = value;
        topLevel.conversions_value = (topLevel.conversions_value ?? 0) + value;
      } else if (actionType === "omni_purchase") {
        topLevel.omni_purchase_value = value;
        topLevel.conversions_value = (topLevel.conversions_value ?? 0) + value;
      } else if (actionType === "offsite_conversion.fb_pixel_complete_payment") {
        topLevel.complete_payment_value = value;
        topLevel.conversions_value = (topLevel.conversions_value ?? 0) + value;
      } else {
        // Store all action_values for downstream use
        topLevel[`action_value_${actionType}`] = value;
      }
    }

    // ROAS data
    for (const [actionType, { total, count }] of Object.entries(roasTotals)) {
      topLevel[`roas_${actionType}`] = total / count;
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

  private getEndpoint(entityId: string, level: EntityLevel): string {
    switch (level) {
      case "account":
        return `${entityId}/insights`;
      case "campaign":
        return `${entityId}/insights`;
      case "adset":
        return `${entityId}/insights`;
      case "ad":
        return `${entityId}/insights`;
    }
  }
}
