// ---------------------------------------------------------------------------
// Report Builder — Core report generation logic
// ---------------------------------------------------------------------------
// Fetches insights from Meta Graph API with configurable breakdowns,
// date ranges, and aggregation levels.
// ---------------------------------------------------------------------------

import type {
  GenerateReportParams,
  CreativeReportParams,
  AudienceReportParams,
  PlacementReportParams,
  ComparisonReportParams,
  PerformanceReport,
  CreativeReport,
  AudienceReport,
  PlacementReport,
  ComparisonReport,
  ReportRow,
  ReportTimeRange,
  ReportLevel,
} from "./types.js";

// ---------------------------------------------------------------------------
// Default fields for insights queries
// ---------------------------------------------------------------------------

const DEFAULT_INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "actions",
  "cost_per_action_type",
  "ctr",
  "cpm",
  "cpc",
  "reach",
  "frequency",
];

const CREATIVE_FIELDS = [
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
  "ctr",
  "cpc",
  "cost_per_action_type",
];

// ---------------------------------------------------------------------------
// Report Builder
// ---------------------------------------------------------------------------

export class ReportBuilder {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async generatePerformanceReport(params: GenerateReportParams): Promise<PerformanceReport> {
    const accountId = this.normalizeAccountId(params.adAccountId);
    const level = params.level ?? "account";
    const breakdowns = params.breakdowns ?? [];
    const fields = params.fields ?? DEFAULT_INSIGHT_FIELDS;

    const endpoint = this.getInsightsEndpoint(accountId, level);
    const timeParams = this.buildTimeParams(params.datePreset, params.timeRange);
    const breakdownParam = breakdowns.length > 0 ? `&breakdowns=${breakdowns.join(",")}` : "";
    const filterParam = params.filtering
      ? `&filtering=${encodeURIComponent(JSON.stringify(params.filtering))}`
      : "";
    const limitParam = params.limit ? `&limit=${params.limit}` : "";

    const url =
      `${endpoint}?fields=${fields.join(",")}` +
      `${timeParams}${breakdownParam}${filterParam}${limitParam}` +
      `&access_token=${this.accessToken}`;

    const rows = await this.fetchAllPages(url);
    const dateRange = this.resolveDateRange(params.datePreset, params.timeRange);

    return {
      rows,
      summary: this.computeSummary(rows),
      dateRange,
      level,
      breakdowns,
    };
  }

  async generateCreativeReport(params: CreativeReportParams): Promise<CreativeReport> {
    const accountId = this.normalizeAccountId(params.adAccountId);
    const timeParams = this.buildTimeParams(params.datePreset, params.timeRange);
    const limitParam = params.limit ? `&limit=${params.limit}` : "&limit=50";

    const url =
      `${this.baseUrl}/${accountId}/ads?fields=` +
      `id,name,creative{id,thumbnail_url,object_type},` +
      `insights.fields(${CREATIVE_FIELDS.join(",")})${timeParams.replace("&", ".")}` +
      `${limitParam}&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const ads = (data.data ?? []) as Record<string, unknown>[];
    const dateRange = this.resolveDateRange(params.datePreset, params.timeRange);

    const creatives = ads.map((ad) => {
      const creative = ad.creative as Record<string, unknown> | undefined;
      const insights = ad.insights as { data?: Record<string, unknown>[] } | undefined;
      const insightRow = insights?.data?.[0] ?? {};
      const actions = (insightRow.actions ?? []) as Array<{
        action_type: string;
        value: string;
      }>;
      const conversions = this.sumActions(actions, ["purchase", "lead", "complete_registration"]);

      return {
        adId: String(ad.id),
        adName: String(ad.name ?? ""),
        creativeId: creative ? String(creative.id) : "",
        thumbnailUrl: creative ? (creative.thumbnail_url as string | null) : null,
        format: creative ? (creative.object_type as string | null) : null,
        spend: Number(insightRow.spend ?? 0),
        impressions: Number(insightRow.impressions ?? 0),
        clicks: Number(insightRow.clicks ?? 0),
        conversions,
        ctr: Number(insightRow.ctr ?? 0),
        cpc: Number(insightRow.cpc ?? 0),
        cpa: conversions > 0 ? Number(insightRow.spend ?? 0) / conversions : null,
      };
    });

    return { creatives, dateRange };
  }

  async generateAudienceReport(params: AudienceReportParams): Promise<AudienceReport> {
    const accountId = this.normalizeAccountId(params.adAccountId);
    const timeParams = this.buildTimeParams(params.datePreset, params.timeRange);
    const fields = "spend,impressions,clicks,actions,ctr";

    // Fetch age + gender breakdown
    const ageGenderUrl =
      `${this.baseUrl}/${accountId}/insights?fields=${fields}` +
      `&breakdowns=age,gender${timeParams}` +
      `&access_token=${this.accessToken}`;
    const ageGenderRows = await this.fetchAllPages(ageGenderUrl);

    // Fetch country breakdown
    const countryUrl =
      `${this.baseUrl}/${accountId}/insights?fields=${fields}` +
      `&breakdowns=country${timeParams}` +
      `&access_token=${this.accessToken}`;
    const countryRows = await this.fetchAllPages(countryUrl);

    const dateRange = this.resolveDateRange(params.datePreset, params.timeRange);

    return {
      ageGender: ageGenderRows.map((row) => {
        const actions = (row.actions ?? []) as Array<{
          action_type: string;
          value: string;
        }>;
        const conversions = this.sumActions(actions, ["purchase", "lead", "complete_registration"]);
        return {
          age: String(row.age ?? ""),
          gender: String(row.gender ?? ""),
          spend: Number(row.spend ?? 0),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          conversions,
          ctr: Number(row.ctr ?? 0),
          cpa: conversions > 0 ? Number(row.spend ?? 0) / conversions : null,
        };
      }),
      countries: countryRows.map((row) => {
        const actions = (row.actions ?? []) as Array<{
          action_type: string;
          value: string;
        }>;
        const conversions = this.sumActions(actions, ["purchase", "lead", "complete_registration"]);
        return {
          country: String(row.country ?? ""),
          spend: Number(row.spend ?? 0),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          conversions,
          ctr: Number(row.ctr ?? 0),
          cpa: conversions > 0 ? Number(row.spend ?? 0) / conversions : null,
        };
      }),
      dateRange,
    };
  }

  async generatePlacementReport(params: PlacementReportParams): Promise<PlacementReport> {
    const accountId = this.normalizeAccountId(params.adAccountId);
    const timeParams = this.buildTimeParams(params.datePreset, params.timeRange);
    const fields = "spend,impressions,clicks,actions,ctr,cpm";

    const url =
      `${this.baseUrl}/${accountId}/insights?fields=${fields}` +
      `&breakdowns=publisher_platform,platform_position${timeParams}` +
      `&access_token=${this.accessToken}`;
    const rows = await this.fetchAllPages(url);
    const dateRange = this.resolveDateRange(params.datePreset, params.timeRange);

    return {
      placements: rows.map((row) => {
        const actions = (row.actions ?? []) as Array<{
          action_type: string;
          value: string;
        }>;
        const conversions = this.sumActions(actions, ["purchase", "lead", "complete_registration"]);
        return {
          platform: String(row.publisher_platform ?? ""),
          position: String(row.platform_position ?? ""),
          spend: Number(row.spend ?? 0),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          conversions,
          ctr: Number(row.ctr ?? 0),
          cpm: Number(row.cpm ?? 0),
          cpa: conversions > 0 ? Number(row.spend ?? 0) / conversions : null,
        };
      }),
      dateRange,
    };
  }

  async generateComparisonReport(params: ComparisonReportParams): Promise<ComparisonReport> {
    const accountId = this.normalizeAccountId(params.adAccountId);
    const level = params.level ?? "account";
    const fields = params.metrics ?? [
      "spend",
      "impressions",
      "clicks",
      "actions",
      "ctr",
      "cpm",
      "cpc",
    ];

    const endpoint = this.getInsightsEndpoint(accountId, level);

    const currentUrl =
      `${endpoint}?fields=${fields.join(",")}&time_range=` +
      encodeURIComponent(JSON.stringify(params.currentPeriod)) +
      `&access_token=${this.accessToken}`;
    const previousUrl =
      `${endpoint}?fields=${fields.join(",")}&time_range=` +
      encodeURIComponent(JSON.stringify(params.previousPeriod)) +
      `&access_token=${this.accessToken}`;

    const [currentRows, previousRows] = await Promise.all([
      this.fetchAllPages(currentUrl),
      this.fetchAllPages(previousUrl),
    ]);

    const currentSummary = this.computeSummary(currentRows);
    const previousSummary = this.computeSummary(previousRows);

    const changes = (
      [
        "totalSpend",
        "totalImpressions",
        "totalClicks",
        "totalConversions",
        "avgCTR",
        "avgCPM",
        "avgCPC",
      ] as const
    ).map((metric) => {
      const cur = currentSummary[metric];
      const prev = previousSummary[metric];
      return {
        metric,
        currentValue: cur,
        previousValue: prev,
        absoluteChange: cur - prev,
        percentChange: prev !== 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0,
      };
    });

    return {
      current: currentRows,
      previous: previousRows,
      changes,
      currentPeriod: params.currentPeriod,
      previousPeriod: params.previousPeriod,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private normalizeAccountId(id: string): string {
    return id.startsWith("act_") ? id : `act_${id}`;
  }

  private getInsightsEndpoint(accountId: string, _level: ReportLevel): string {
    return `${this.baseUrl}/${accountId}/insights`;
  }

  private buildTimeParams(preset?: string, timeRange?: ReportTimeRange): string {
    if (timeRange) {
      return `&time_range=${encodeURIComponent(JSON.stringify(timeRange))}`;
    }
    if (preset) {
      return `&date_preset=${preset}`;
    }
    return "&date_preset=last_7d";
  }

  private resolveDateRange(preset?: string, timeRange?: ReportTimeRange): ReportTimeRange {
    if (timeRange) return timeRange;
    const now = new Date();
    const daysBack = preset === "last_30d" ? 30 : preset === "last_14d" ? 14 : 7;
    const since = new Date(now);
    since.setDate(since.getDate() - daysBack);
    return {
      since: since.toISOString().split("T")[0]!,
      until: now.toISOString().split("T")[0]!,
    };
  }

  private computeSummary(rows: ReportRow[]) {
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;
    for (const row of rows) {
      totalSpend += Number(row.spend ?? 0);
      totalImpressions += Number(row.impressions ?? 0);
      totalClicks += Number(row.clicks ?? 0);
      const actions = (row.actions ?? []) as Array<{
        action_type: string;
        value: string;
      }>;
      totalConversions += this.sumActions(actions, ["purchase", "lead", "complete_registration"]);
    }
    return {
      totalSpend,
      totalImpressions,
      totalClicks,
      totalConversions,
      avgCTR: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      avgCPM: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      avgCPC: totalClicks > 0 ? totalSpend / totalClicks : 0,
    };
  }

  private sumActions(
    actions: Array<{ action_type: string; value: string }>,
    types: string[],
  ): number {
    return actions
      .filter((a) => types.includes(a.action_type))
      .reduce((sum, a) => sum + Number(a.value), 0);
  }

  private async fetchAllPages(url: string): Promise<ReportRow[]> {
    const rows: ReportRow[] = [];
    let nextUrl: string | null = url;
    while (nextUrl) {
      const data = await this.fetchJson(nextUrl);
      if (data.data) {
        for (const item of data.data as ReportRow[]) {
          rows.push(item);
        }
      }
      nextUrl = ((data.paging as Record<string, unknown> | undefined)?.next as string) ?? null;
    }
    return rows;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
