// packages/core/src/ad-optimizer/meta-ads-client.ts
import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetInsightSchema as AdSetInsight,
  AccountSummarySchema as AccountSummary,
  AdSetLearningInput,
} from "@switchboard/schemas";

const API_BASE = "https://graph.facebook.com/v21.0";
const RATE_LIMIT_MS = 60_000;

/**
 * Parse an external Meta numeric, coercing any non-finite result to a fallback
 * (default 0). Meta returns numerics as strings; a non-numeric sentinel ("N/A",
 * an empty string, a malformed payload) makes parseFloat/parseInt yield NaN,
 * which must never reach a comparison gate: a `>`-gate reads NaN as false
 * silently and voids a recommendation, and one NaN row poisons a whole `reduce`
 * sum (feedback_nan_blind_comparison_gates, #939). 0 is the honest fallback for
 * every field here (spend/conversions/revenue/impressions/clicks/rates): it is
 * the safe no-false-action direction and isolates damage to the single bad row.
 * The peer guard at meta-campaign-insights-provider.ts (action-type denominator)
 * uses the same Number.isFinite discipline; this keeps both boundaries symmetric.
 */
function finiteFloat(value: unknown, fallback = 0): number {
  const n = parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : fallback;
}

function finiteInt(value: unknown, fallback = 0): number {
  const n = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) ? n : fallback;
}

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
  timeIncrement?: number;
  /**
   * Pins the Meta `action_attribution_windows` for the `actions` breakdown (e.g.
   * `["7d_click"]`). When set, action values are reported under exactly these
   * windows instead of the account default. Used by the breach detector so the
   * conversions denominator (per `conversionActionType`) is stable across runs.
   */
  actionAttributionWindows?: string[];
  /**
   * Meta `filtering` clauses (e.g. `[{field:"campaign.id", operator:"IN",
   * value:[...]}]`). Scoping the account-level read server-side keeps campaigns
   * of interest inside the first response page (this client does not follow
   * `paging.next`) and shrinks the payload. Used by the creative-attribution
   * sweep to scope to published Mira campaigns.
   */
  filtering?: Array<{ field: string; operator: string; value: unknown }>;
}

interface AdSetInsightsParams {
  dateRange: DateRange;
  fields: string[];
  campaignId?: string;
  /** Page size. Defaults to Meta's small (~25) page when unset; set to match the paired
   * `/adsets` entity cap so account-level joins don't drop the ad-set tail to spend:0. */
  limit?: number;
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

interface CreateAdCreativeParams {
  name: string;
  pageId: string;
  videoId: string;
  message: string;
  linkUrl: string;
  callToActionType?: string;
  imageHash?: string;
}

interface CreateAdParams {
  name: string;
  adSetId: string;
  creativeId: string;
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
  private readonly adCampaignCache = new Map<string, string>();

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

    if (params.timeIncrement !== undefined) {
      queryParams.set("time_increment", String(params.timeIncrement));
    }

    if (params.actionAttributionWindows) {
      queryParams.set(
        "action_attribution_windows",
        JSON.stringify(params.actionAttributionWindows),
      );
    }

    if (params.filtering) {
      queryParams.set("filtering", JSON.stringify(params.filtering));
    }

    const response = await this.get(`/${this.accountId}/insights?${queryParams.toString()}`);
    const data = response.data as Record<string, unknown>[];
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

    if (params.limit !== undefined) {
      queryParams.set("limit", String(params.limit));
    }

    const response = await this.get(`/${this.accountId}/insights?${queryParams.toString()}`);
    const data = response.data as Record<string, string>[];
    return data.map((raw) => this.mapAdSetInsight(raw));
  }

  /**
   * Per-campaign ad-set learning inputs (learning_stage_info + destination_type + spend),
   * used by MetaCampaignInsightsProvider to derive the campaign-level learning phase.
   */
  async getAdSetLearningInputs(campaignId: string): Promise<AdSetLearningInput[]> {
    return this.fetchAdSetLearningInputs({ campaignId, dateRange: this.last7DayRange() });
  }

  /**
   * Account-level ad-set learning inputs (ALL ad sets, no campaign filter). Feeds the weekly
   * audit's per-source spend attribution: each ad set's `destination_type` maps to a funnel
   * source (`destinationTypeToSource`) so spend can be attributed without the synthetic
   * lead-share fallback. ADVISORY-ONLY read path: two account-level GETs (the `/adsets` config
   * edge + ad-set insights), each behind the 60s rate limiter.
   */
  async getAccountAdSetLearningInputs(dateRange: {
    since: string;
    until: string;
  }): Promise<AdSetLearningInput[]> {
    return this.fetchAdSetLearningInputs({ dateRange });
  }

  private async fetchAdSetLearningInputs(opts: {
    campaignId?: string;
    dateRange: { since: string; until: string };
  }): Promise<AdSetLearningInput[]> {
    // NOTE: reads Graph page 1 only (no paging.next follow) on BOTH the entity (/adsets) and
    // the paired insights edge, each capped at 200. Covers typical accounts; for >200 ad sets
    // the two edges truncate consistently, so the tail is simply unattributed → coverage drops
    // → honest abstain (fail-safe). Follow paging.next before broad enablement at larger scale.
    const qpInit: Record<string, string> = {
      fields: "id,name,campaign_id,destination_type,learning_stage_info",
      limit: "200",
    };
    if (opts.campaignId) {
      qpInit.filtering = JSON.stringify([
        { field: "campaign.id", operator: "EQUAL", value: opts.campaignId },
      ]);
    }
    const qp = new URLSearchParams(qpInit);
    const entityResp = await this.get(`/${this.accountId}/adsets?${qp.toString()}`);
    const entities = (entityResp.data as Record<string, unknown>[]) ?? [];

    const insights = await this.getAdSetInsights({
      dateRange: opts.dateRange,
      fields: ["adset_id", "spend", "conversions", "frequency", "inline_link_click_ctr"],
      limit: 200,
      ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
    });
    const spendByAdSet = new Map<string, AdSetInsight>();
    for (const ins of insights) spendByAdSet.set(ins.adSetId, ins);

    return entities.map((e) => {
      const id = String(e.id ?? "");
      const ins = spendByAdSet.get(id);
      const rawStatus = (
        (e.learning_stage_info as { status?: string } | undefined)?.status ?? "UNKNOWN"
      ).toUpperCase();
      const learningStageStatus = (
        ["LEARNING", "SUCCESS", "FAIL"].includes(rawStatus) ? rawStatus : "UNKNOWN"
      ) as AdSetLearningInput["learningStageStatus"];
      const spend = ins?.spend ?? 0;
      const conversions = ins?.conversions ?? 0;
      const destinationType = e.destination_type ? String(e.destination_type) : undefined;
      return {
        adSetId: id,
        adSetName: String(e.name ?? ""),
        campaignId: String(e.campaign_id ?? opts.campaignId ?? ""),
        learningStageStatus,
        frequency: ins?.frequency ?? 0,
        spend,
        conversions,
        cpa: conversions > 0 ? spend / conversions : 0,
        roas: 0,
        inlineLinkClickCtr: ins?.inlineLinkClickCtr ?? 0,
        ...(destinationType ? { destinationType } : {}),
      };
    });
  }

  private last7DayRange(): { since: string; until: string } {
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    const f = (d: Date) => d.toISOString().split("T")[0]!;
    return { since: f(since), until: f(now) };
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
      totalSpend: finiteFloat(insights.spend),
      totalImpressions: finiteInt(insights.impressions),
      totalClicks: finiteInt(insights.clicks),
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

  async createAdCreative(params: CreateAdCreativeParams): Promise<{ id: string }> {
    // Video-only by design: the creative pipeline produces video. An image creative
    // would use object_story_spec.link_data/image_data instead of video_data.
    const body = {
      name: params.name,
      object_story_spec: {
        page_id: params.pageId,
        video_data: {
          video_id: params.videoId,
          message: params.message,
          ...(params.imageHash ? { image_hash: params.imageHash } : {}),
          call_to_action: {
            type: params.callToActionType ?? "LEARN_MORE",
            value: { link: params.linkUrl },
          },
        },
      },
    };

    const response = await this.post(`/${this.accountId}/adcreatives`, body);
    return { id: response.id as string };
  }

  async createAd(params: CreateAdParams): Promise<{ id: string }> {
    // status is hardcoded PAUSED and intentionally NOT a parameter — there is no
    // path through this client to create a live ad. Activation is a human action
    // in Ads Manager (see updateCampaignStatus, which throws on "ACTIVE").
    const body = {
      name: params.name,
      adset_id: params.adSetId,
      creative: { creative_id: params.creativeId },
      status: "PAUSED",
    };

    const response = await this.post(`/${this.accountId}/ads`, body);
    return { id: response.id as string };
  }

  async updateCampaignStatus(campaignId: string, status: CampaignStatus): Promise<void> {
    if (status === "ACTIVE") {
      throw new Error(
        "SAFETY: Agent cannot activate campaigns. Human must publish via Ads Manager.",
      );
    }

    await this.post(`/${campaignId}`, { status });
  }

  /**
   * Read one campaign's status (Phase-C pause executor pre-read). Degrades to
   * null on any error: the pause write itself is the honest test; a status-read
   * blip must not block an approved pause.
   */
  async getCampaignStatus(
    campaignId: string,
  ): Promise<{ status: string; effectiveStatus: string } | null> {
    try {
      const response = await this.get(`/${campaignId}?fields=status,effective_status`);
      return {
        status: String(response.status ?? ""),
        effectiveStatus: String(response.effective_status ?? ""),
      };
    } catch {
      return null;
    }
  }

  /**
   * Read one campaign's budget + status for the Spec-1B reallocation read-modify-re-read executor
   * (close-the-revenue-loop spec section 7). THROWS on a Meta error (unlike getCampaignStatus, which
   * degrades to null): a money move cannot proceed on an unknown budget, so the executor fails closed.
   * dailyBudgetCents is Meta's NATIVE minor units (cents), parsed VERBATIM (no x100; contrast
   * getAccountDailySpendCents, where insights `spend` is a dollars string). null when absent (the
   * campaign budgets at the ad-set level -> the executor refuses UNSUPPORTED_BUDGET_TOPOLOGY),
   * non-numeric (strict /^\d+$/, never coerces "5000abc"), or zero - honest-null, NEVER a coerced 0
   * (a 0 would read as "free to move the whole budget"; feedback_nan_blind_comparison_gates).
   */
  async getCampaign(campaignId: string): Promise<{
    campaignId: string;
    name: string;
    status: string;
    dailyBudgetCents: number | null;
  }> {
    const response = await this.get(`/${campaignId}?fields=id,name,status,daily_budget`);
    const rawStr = response.daily_budget == null ? "" : String(response.daily_budget);
    const parsed = /^\d+$/.test(rawStr) ? Number(rawStr) : Number.NaN;
    const dailyBudgetCents = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    return {
      campaignId: String(response.id ?? campaignId),
      name: String(response.name ?? ""),
      status: String(response.status ?? ""),
      dailyBudgetCents,
    };
  }

  async getAdCampaignId(adId: string): Promise<string | null> {
    const cached = this.adCampaignCache.get(adId);
    if (cached !== undefined) return cached;

    try {
      const response = await this.get(`/${adId}?fields=campaign_id`);
      const campaignId = response.campaign_id as string | undefined;
      if (campaignId) {
        this.adCampaignCache.set(adId, campaignId);
        return campaignId;
      }
      return null;
    } catch {
      return null;
    }
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

  private mapCampaignInsight(raw: Record<string, unknown>): CampaignInsight {
    return {
      campaignId: String(raw.campaign_id ?? ""),
      campaignName: String(raw.campaign_name ?? ""),
      status: String(raw.status ?? ""),
      effectiveStatus: String(raw.effective_status ?? ""),
      impressions: finiteInt(raw.impressions),
      inlineLinkClicks: finiteInt(raw.inline_link_clicks),
      spend: finiteFloat(raw.spend),
      conversions: finiteFloat(raw.conversions),
      revenue: finiteFloat(raw.revenue),
      frequency: finiteFloat(raw.frequency),
      cpm: finiteFloat(raw.cpm),
      inlineLinkClickCtr: finiteFloat(raw.inline_link_click_ctr),
      costPerInlineLinkClick: finiteFloat(raw.cost_per_inline_link_click),
      dateStart: String(raw.date_start ?? ""),
      dateStop: String(raw.date_stop ?? ""),
      // Meta returns `actions` as an array of { action_type, value }. Surface it
      // verbatim when present so action-type-scoped denominators can read it.
      ...(Array.isArray(raw.actions)
        ? { actions: raw.actions as { action_type: string; value: string }[] }
        : {}),
    };
  }

  private mapAdSetInsight(raw: Record<string, string>): AdSetInsight {
    return {
      adSetId: raw.adset_id ?? "",
      adSetName: raw.adset_name ?? "",
      campaignId: raw.campaign_id ?? "",
      impressions: finiteInt(raw.impressions),
      inlineLinkClicks: finiteInt(raw.inline_link_clicks),
      spend: finiteFloat(raw.spend),
      conversions: finiteFloat(raw.conversions),
      frequency: finiteFloat(raw.frequency),
      cpm: finiteFloat(raw.cpm),
      inlineLinkClickCtr: finiteFloat(raw.inline_link_click_ctr),
      costPerInlineLinkClick: finiteFloat(raw.cost_per_inline_link_click),
      dateStart: raw.date_start ?? "",
      dateStop: raw.date_stop ?? "",
    };
  }
}
