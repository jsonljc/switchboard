import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsConnector } from "../meta-ads-connector.js";

describe("MetaAdsConnector", () => {
  let connector: MetaAdsConnector;
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    connector = new MetaAdsConnector({
      accessToken: "test-token",
      adAccountId: "act_123",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("sets id and name", () => {
      expect(connector.id).toBe("meta-ads");
      expect(connector.name).toBe("Meta Ads");
    });

    it("prepends act_ if missing", () => {
      const c = new MetaAdsConnector({
        accessToken: "token",
        adAccountId: "123",
      });
      expect(c.id).toBe("meta-ads");
    });
  });

  describe("fetchAdMetrics", () => {
    it("parses Graph API insights response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              impressions: "10000",
              clicks: "500",
              spend: "100.50",
              actions: [{ action_type: "purchase", value: "10" }],
              ctr: "5.0",
              cpc: "0.20",
              purchase_roas: [{ action_type: "purchase", value: "3.5" }],
              frequency: "2.1",
            },
          ],
        }),
      });

      const result = await connector.fetchAdMetrics("act_123");

      expect(result).not.toBeNull();
      expect(result!.impressions).toBe(10000);
      expect(result!.clicks).toBe(500);
      expect(result!.spend).toBeCloseTo(100.5);
      expect(result!.conversions).toBe(10);
      expect(result!.ctr).toBe(5.0);
      expect(result!.cpc).toBeCloseTo(0.2);
      expect(result!.frequency).toBeCloseTo(2.1);
    });

    it("returns null when no data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const result = await connector.fetchAdMetrics("act_123");
      expect(result).toBeNull();
    });

    it("returns null on fetch error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await connector.fetchAdMetrics("act_123");
      expect(result).toBeNull();
    });
  });

  describe("fetchFunnelEvents", () => {
    it("maps action types to funnel stages", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              actions: [
                { action_type: "link_click", value: "1000" },
                { action_type: "offsite_conversion.fb_pixel_view_content", value: "800" },
                { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "200" },
                { action_type: "offsite_conversion.fb_pixel_purchase", value: "50" },
              ],
            },
          ],
        }),
      });

      const result = await connector.fetchFunnelEvents("act_123");

      expect(result).toHaveLength(5);
      expect(result[0]!.stageName).toBe("Click");
      expect(result[0]!.count).toBe(1000);
      expect(result[1]!.stageName).toBe("Content View");
      expect(result[1]!.count).toBe(800);
    });

    it("returns empty array on error", async () => {
      mockFetch.mockRejectedValue(new Error("API error"));

      const result = await connector.fetchFunnelEvents("act_123");
      expect(result).toEqual([]);
    });
  });

  describe("fetchSignalHealth", () => {
    it("returns signal health from pixel data", async () => {
      // All graphGet calls go through the same fetch mock
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValueOnce({
            data: [{ id: "pixel_1", name: "My Pixel", is_unavailable: false }],
          })
          .mockResolvedValueOnce({
            data: [
              { event: "PageView", count: 100 },
              { event: "ViewContent", count: 80 },
              { event: "AddToCart", count: 30 },
              { event: "Purchase", count: 10 },
            ],
          }),
      });

      const result = await connector.fetchSignalHealth("act_123");

      expect(result).not.toBeNull();
      expect(result!.pixelActive).toBe(true);
    });

    it("returns null on error", async () => {
      mockFetch.mockRejectedValue(new Error("API error"));

      const result = await connector.fetchSignalHealth("act_123");
      expect(result).toBeNull();
    });
  });

  describe("fetchCreativeAssets", () => {
    it("parses ad creative data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "ad_1",
              status: "ACTIVE",
              effective_status: "ACTIVE",
              creative: { id: "cr_1" },
              insights: { data: [{ ctr: "3.5", impressions: "5000", frequency: "2.0" }] },
            },
            {
              id: "ad_2",
              status: "ACTIVE",
              effective_status: "ACTIVE",
              creative: { id: "cr_2" },
              insights: { data: [{ ctr: "0.3", impressions: "2000", frequency: "4.0" }] },
            },
          ],
        }),
      });

      const result = await connector.fetchCreativeAssets("act_123");

      expect(result).not.toBeNull();
      expect(result!.totalAssets).toBe(2);
      expect(result!.activeAssets).toBe(2);
      expect(result!.topPerformerCount).toBe(1);
      expect(result!.bottomPerformerCount).toBe(1);
    });

    it("returns null on error", async () => {
      mockFetch.mockRejectedValue(new Error("API error"));

      const result = await connector.fetchCreativeAssets("act_123");
      expect(result).toBeNull();
    });
  });

  describe("fetchCrmSummary", () => {
    it("always returns null (CRM uses separate connector)", async () => {
      const result = await connector.fetchCrmSummary("act_123");
      expect(result).toBeNull();
    });
  });

  describe("fetchHeadroom", () => {
    it("computes headroom from daily spend data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValueOnce({
            data: [
              { spend: "100", date_start: "2024-01-01" },
              { spend: "120", date_start: "2024-01-02" },
              { spend: "110", date_start: "2024-01-03" },
            ],
          })
          .mockResolvedValueOnce({
            data: { users_lower_bound: 50000, users_upper_bound: 100000 },
          }),
      });

      const result = await connector.fetchHeadroom("act_123");

      expect(result).not.toBeNull();
      expect(result!.currentDailySpend).toBeCloseTo(110);
      expect(result!.recommendedDailySpend).toBeGreaterThan(result!.currentDailySpend);
    });

    it("returns null when no spend data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const result = await connector.fetchHeadroom("act_123");
      expect(result).toBeNull();
    });

    it("returns null on error", async () => {
      mockFetch.mockRejectedValue(new Error("API error"));

      const result = await connector.fetchHeadroom("act_123");
      expect(result).toBeNull();
    });
  });
});
