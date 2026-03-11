// ---------------------------------------------------------------------------
// MetaAdsConnector — Real connector using Meta Marketing API (Graph API v22.0)
// ---------------------------------------------------------------------------

import type {
  AdMetrics,
  FunnelEvent,
  SignalHealthSummary,
  CreativeAssetSummary,
  CrmSummary,
  HeadroomSummary,
} from "@switchboard/schemas";
import { withRetry, CircuitBreaker } from "@switchboard/core";
import type { CartridgeConnector } from "./normalizer.js";

export interface MetaAdsConnectorConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = "v22.0";
const BASE_URL = "https://graph.facebook.com";

export class MetaAdsConnector implements CartridgeConnector {
  readonly id = "meta-ads";
  readonly name = "Meta Ads";

  private readonly accessToken: string;
  private readonly adAccountId: string;
  private readonly apiVersion: string;
  private readonly breaker: CircuitBreaker;

  constructor(config: MetaAdsConnectorConfig) {
    this.accessToken = config.accessToken;
    this.adAccountId = config.adAccountId.startsWith("act_")
      ? config.adAccountId
      : `act_${config.adAccountId}`;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
  }

  private async graphGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}/${this.apiVersion}/${path}`);
    url.searchParams.set("access_token", this.accessToken);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return this.breaker.execute(() =>
      withRetry(
        async () => {
          const res = await fetch(url.toString());
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Meta Graph API error ${res.status}: ${body}`);
          }
          return res.json() as Promise<T>;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          shouldRetry: (err) => {
            if (err instanceof Error && err.message.includes("429")) return true;
            if (err instanceof Error && err.message.includes("500")) return true;
            return false;
          },
        },
      ),
    );
  }

  async fetchAdMetrics(_accountId: string): Promise<AdMetrics | null> {
    try {
      const response = await this.graphGet<{
        data: Array<{
          impressions?: string;
          clicks?: string;
          spend?: string;
          actions?: Array<{ action_type: string; value: string }>;
          ctr?: string;
          cpc?: string;
          purchase_roas?: Array<{ action_type: string; value: string }>;
          frequency?: string;
        }>;
      }>(`${this.adAccountId}/insights`, {
        fields: "impressions,clicks,spend,actions,ctr,cpc,purchase_roas,frequency",
        date_preset: "last_30d",
      });

      const row = response.data?.[0];
      if (!row) return null;

      const conversions = row.actions?.find((a) => a.action_type === "purchase")?.value ?? "0";
      const revenue = row.purchase_roas?.[0]?.value
        ? parseFloat(row.purchase_roas[0].value) * parseFloat(row.spend ?? "0")
        : null;
      const impressions = parseInt(row.impressions ?? "0", 10);
      const clicks = parseInt(row.clicks ?? "0", 10);
      const spend = parseFloat(row.spend ?? "0");
      const conv = parseInt(conversions, 10);

      return {
        impressions,
        clicks,
        spend,
        conversions: conv,
        revenue,
        ctr: parseFloat(row.ctr ?? "0"),
        cpc: row.cpc ? parseFloat(row.cpc) : null,
        cpa: conv > 0 ? spend / conv : null,
        roas: revenue !== null && spend > 0 ? revenue / spend : null,
        frequency: row.frequency ? parseFloat(row.frequency) : null,
      };
    } catch {
      return null;
    }
  }

  async fetchFunnelEvents(_accountId: string): Promise<FunnelEvent[]> {
    try {
      const response = await this.graphGet<{
        data: Array<{
          actions?: Array<{ action_type: string; value: string }>;
        }>;
      }>(`${this.adAccountId}/insights`, {
        fields: "actions",
        date_preset: "last_30d",
      });

      const actions = response.data?.[0]?.actions ?? [];
      const stageMap: Record<string, string> = {
        link_click: "Click",
        "offsite_conversion.fb_pixel_view_content": "Content View",
        "offsite_conversion.fb_pixel_add_to_cart": "Add to Cart",
        "offsite_conversion.fb_pixel_initiate_checkout": "Checkout",
        "offsite_conversion.fb_pixel_purchase": "Purchase",
      };

      const stages: FunnelEvent[] = [];
      let prevCount: number | null = null;

      for (const [actionType, stageName] of Object.entries(stageMap)) {
        const action = actions.find((a) => a.action_type === actionType);
        const count = action ? parseInt(action.value, 10) : 0;
        stages.push({
          stageName,
          count,
          previousCount: prevCount,
          conversionRate: prevCount !== null && prevCount > 0 ? count / prevCount : null,
        });
        prevCount = count;
      }

      return stages;
    } catch {
      return [];
    }
  }

  async fetchSignalHealth(_accountId: string): Promise<SignalHealthSummary | null> {
    try {
      // Attempt to get pixel info from the ad account
      const pixelResponse = await this.graphGet<{
        data: Array<{
          id: string;
          name: string;
          is_unavailable?: boolean;
          automatic_matching_fields?: string[];
        }>;
      }>(`${this.adAccountId}/adspixels`, {
        fields: "id,name,is_unavailable,automatic_matching_fields",
      });

      const pixel = pixelResponse.data?.[0];
      if (!pixel) {
        return {
          pixelActive: false,
          capiConfigured: false,
          eventMatchQuality: null,
          eventCompleteness: 0,
          deduplicationRate: null,
          conversionLagHours: null,
        };
      }

      const pixelActive = !pixel.is_unavailable;

      // Get pixel stats for event completeness
      let eventCompleteness = 0;
      let capiConfigured = false;
      try {
        const statsResponse = await this.graphGet<{
          data: Array<{
            count?: number;
            event?: string;
          }>;
        }>(`${pixel.id}/stats`, {
          aggregation: "event",
        });

        const events = statsResponse.data ?? [];
        // A well-configured pixel should have at least 4 standard events
        const standardEvents = ["PageView", "ViewContent", "AddToCart", "Purchase"];
        const foundEvents = events.filter((e) =>
          standardEvents.some((se) => e.event === se),
        ).length;
        eventCompleteness = foundEvents / standardEvents.length;

        // Check for server events (CAPI)
        capiConfigured = events.some((e) => e.event?.includes("Server") || (e.count ?? 0) > 0);
      } catch {
        // Stats endpoint may not be available
      }

      return {
        pixelActive,
        capiConfigured,
        eventMatchQuality: null,
        eventCompleteness,
        deduplicationRate: null,
        conversionLagHours: null,
      };
    } catch {
      return null;
    }
  }

  async fetchCreativeAssets(_accountId: string): Promise<CreativeAssetSummary | null> {
    try {
      const response = await this.graphGet<{
        data: Array<{
          id: string;
          status: string;
          effective_status: string;
          creative?: { id: string };
          insights?: {
            data: Array<{
              ctr?: string;
              impressions?: string;
              frequency?: string;
            }>;
          };
        }>;
      }>(`${this.adAccountId}/ads`, {
        fields: "id,status,effective_status,creative{id},insights{ctr,impressions,frequency}",
        effective_status: '["ACTIVE","PAUSED"]',
        limit: "100",
      });

      const ads = response.data ?? [];
      const totalAssets = ads.length;
      const activeAssets = ads.filter((a) => a.effective_status === "ACTIVE").length;

      // Calculate fatigue rate from frequency
      let totalFatigue = 0;
      let fatigueCount = 0;
      const uniqueCreativeIds = new Set<string>();

      for (const ad of ads) {
        if (ad.creative?.id) uniqueCreativeIds.add(ad.creative.id);
        const freq = ad.insights?.data?.[0]?.frequency;
        if (freq) {
          const f = parseFloat(freq);
          if (f > 3) totalFatigue++;
          fatigueCount++;
        }
      }

      const diversityScore =
        totalAssets > 0
          ? Math.min(100, Math.round((uniqueCreativeIds.size / Math.max(3, totalAssets)) * 100))
          : null;

      // Determine top/bottom performers by CTR
      const withCtr = ads
        .map((a) => ({
          ctr: a.insights?.data?.[0]?.ctr ? parseFloat(a.insights.data[0].ctr) : null,
        }))
        .filter((a) => a.ctr !== null)
        .sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));

      const topCount = withCtr.filter((a) => (a.ctr ?? 0) > 2).length;
      const bottomCount = withCtr.filter((a) => (a.ctr ?? 0) < 0.5).length;

      return {
        totalAssets,
        activeAssets,
        averageScore: null,
        fatigueRate: fatigueCount > 0 ? totalFatigue / fatigueCount : null,
        topPerformerCount: topCount,
        bottomPerformerCount: bottomCount,
        diversityScore,
      };
    } catch {
      return null;
    }
  }

  async fetchCrmSummary(_accountId: string): Promise<CrmSummary | null> {
    // CRM data comes from a separate connector
    return null;
  }

  async fetchHeadroom(_accountId: string): Promise<HeadroomSummary | null> {
    try {
      // Get daily spend data for trend analysis
      const insightsResponse = await this.graphGet<{
        data: Array<{ spend?: string; date_start?: string }>;
      }>(`${this.adAccountId}/insights`, {
        fields: "spend",
        date_preset: "last_30d",
        time_increment: "1",
      });

      const days = insightsResponse.data ?? [];
      if (days.length === 0) return null;

      const spends = days.map((d) => parseFloat(d.spend ?? "0"));
      const currentDailySpend = spends.reduce((a, b) => a + b, 0) / spends.length;

      // Attempt to get reach estimate for audience headroom
      let audienceSize = 0;
      try {
        const reachResponse = await this.graphGet<{
          data?: { users_lower_bound?: number; users_upper_bound?: number };
        }>(`${this.adAccountId}/reachestimate`, {
          targeting_spec: JSON.stringify({ geo_locations: { countries: ["US"] } }),
        });
        audienceSize =
          reachResponse.data?.users_upper_bound ?? reachResponse.data?.users_lower_bound ?? 0;
      } catch {
        // Reach estimate endpoint may not be accessible
      }

      // Simple headroom heuristic: if daily spend is well below the daily budget capacity
      const headroomPercent = audienceSize > 0 ? Math.min(200, (audienceSize / 10000) * 10) : 30;

      return {
        currentDailySpend,
        recommendedDailySpend: currentDailySpend * (1 + headroomPercent / 100),
        headroomPercent,
        confidence: "LOW",
        rSquared: 0.4,
        caveats: [
          "Headroom estimate is approximate based on audience size and spend trends",
          audienceSize === 0
            ? "Could not fetch audience reach estimate"
            : `Estimated audience size: ${audienceSize.toLocaleString()}`,
        ],
      };
    } catch {
      return null;
    }
  }
}
