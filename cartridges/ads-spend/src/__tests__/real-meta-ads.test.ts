import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MetaAdsConfig } from "../providers/meta-ads.js";
import { MockMetaAdsProvider } from "../providers/meta-ads.js";
import { RealMetaAdsProvider } from "../providers/real-meta-ads.js";
import { MetaApiError, MetaRateLimitError, MetaAuthError } from "../providers/errors.js";
import { createMetaAdsProvider } from "../providers/factory.js";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

const TEST_CONFIG: MetaAdsConfig = {
  accessToken: "EAAxxxxxxxxxxxxxxxxxxxxxxxxx_long_token",
  adAccountId: "act_12345",
  apiVersion: "v21.0",
};

const META_CAMPAIGN_RAW = {
  id: "123456",
  name: "Summer Sale",
  status: "ACTIVE",
  daily_budget: "5000",
  lifetime_budget: undefined,
  effective_status: "ACTIVE",
  start_time: "2026-01-01T00:00:00+0000",
  end_time: undefined,
  objective: "CONVERSIONS",
};

describe("RealMetaAdsProvider", () => {
  let provider: RealMetaAdsProvider;

  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    provider = new RealMetaAdsProvider(TEST_CONFIG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // getCampaign
  // ---------------------------------------------------------------------------
  describe("getCampaign", () => {
    it("fetches and maps campaign data", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(META_CAMPAIGN_RAW));

      const campaign = await provider.getCampaign("123456");

      expect(campaign.id).toBe("123456");
      expect(campaign.name).toBe("Summer Sale");
      expect(campaign.status).toBe("ACTIVE");
      expect(campaign.dailyBudget).toBe(5000);
      expect(campaign.lifetimeBudget).toBeNull();
      expect(campaign.deliveryStatus).toBe("ACTIVE");
      expect(campaign.objective).toBe("CONVERSIONS");

      expect(mockFetch).toHaveBeenCalledOnce();
      const url = new URL(mockFetch.mock.calls[0]![0] as string);
      expect(url.pathname).toBe("/v21.0/123456");
      expect(url.searchParams.get("access_token")).toBe(TEST_CONFIG.accessToken);
    });

    it("maps lifetime_budget correctly", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        ...META_CAMPAIGN_RAW,
        daily_budget: undefined,
        lifetime_budget: "100000",
      }));

      const campaign = await provider.getCampaign("123456");
      expect(campaign.dailyBudget).toBe(0);
      expect(campaign.lifetimeBudget).toBe(100000);
    });
  });

  // ---------------------------------------------------------------------------
  // searchCampaigns
  // ---------------------------------------------------------------------------
  describe("searchCampaigns", () => {
    it("sends filtering parameter when query is provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        data: [META_CAMPAIGN_RAW],
        paging: {},
      }));

      const campaigns = await provider.searchCampaigns("Summer");

      expect(campaigns).toHaveLength(1);
      expect(campaigns[0]!.name).toBe("Summer Sale");

      const url = new URL(mockFetch.mock.calls[0]![0] as string);
      expect(url.pathname).toBe("/v21.0/act_12345/campaigns");
      const filtering = url.searchParams.get("filtering");
      expect(filtering).toContain("Summer");
    });

    it("omits filtering when query is empty", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        data: [META_CAMPAIGN_RAW],
        paging: {},
      }));

      await provider.searchCampaigns("");

      const url = new URL(mockFetch.mock.calls[0]![0] as string);
      expect(url.searchParams.has("filtering")).toBe(false);
    });

    it("handles cursor pagination", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          data: [META_CAMPAIGN_RAW],
          paging: { next: "https://graph.facebook.com/v21.0/act_12345/campaigns?after=cursor1" },
        }))
        .mockResolvedValueOnce(jsonResponse({
          data: [{ ...META_CAMPAIGN_RAW, id: "789", name: "Page 2 Campaign" }],
          paging: {},
        }));

      const campaigns = await provider.searchCampaigns("");

      expect(campaigns).toHaveLength(2);
      expect(campaigns[0]!.id).toBe("123456");
      expect(campaigns[1]!.id).toBe("789");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("prepends act_ prefix if missing from adAccountId", async () => {
      const noPrefix = new RealMetaAdsProvider({
        ...TEST_CONFIG,
        adAccountId: "12345",
      });

      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], paging: {} }));
      await noPrefix.searchCampaigns("");

      const url = new URL(mockFetch.mock.calls[0]![0] as string);
      expect(url.pathname).toContain("act_12345");
    });
  });

  // ---------------------------------------------------------------------------
  // pauseCampaign / resumeCampaign
  // ---------------------------------------------------------------------------
  describe("pauseCampaign", () => {
    it("captures previousStatus and sends PAUSED", async () => {
      // First call: getCampaign, second call: POST to pause
      mockFetch
        .mockResolvedValueOnce(jsonResponse(META_CAMPAIGN_RAW))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await provider.pauseCampaign("123456");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("ACTIVE");

      // Verify POST body
      const postCall = mockFetch.mock.calls[1]!;
      expect(postCall[1]).toHaveProperty("method", "POST");
      const body = JSON.parse(postCall[1]!.body as string);
      expect(body.status).toBe("PAUSED");
    });
  });

  describe("resumeCampaign", () => {
    it("captures previousStatus and sends ACTIVE", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ ...META_CAMPAIGN_RAW, status: "PAUSED" }))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await provider.resumeCampaign("123456");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("PAUSED");

      const body = JSON.parse(mockFetch.mock.calls[1]![1]!.body as string);
      expect(body.status).toBe("ACTIVE");
    });
  });

  // ---------------------------------------------------------------------------
  // updateBudget
  // ---------------------------------------------------------------------------
  describe("updateBudget", () => {
    it("sends cents as string in daily_budget", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(META_CAMPAIGN_RAW))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      const result = await provider.updateBudget("123456", 10000);

      expect(result.success).toBe(true);
      expect(result.previousBudget).toBe(5000);

      const body = JSON.parse(mockFetch.mock.calls[1]![1]!.body as string);
      expect(body.daily_budget).toBe("10000");
    });

    it("uses lifetime_budget when campaign has one", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          ...META_CAMPAIGN_RAW,
          daily_budget: undefined,
          lifetime_budget: "50000",
        }))
        .mockResolvedValueOnce(jsonResponse({ success: true }));

      await provider.updateBudget("123456", 100000);

      const body = JSON.parse(mockFetch.mock.calls[1]![1]!.body as string);
      expect(body.lifetime_budget).toBe("100000");
      expect(body.daily_budget).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe("error handling", () => {
    beforeEach(() => {
      // Mock the private delay method to resolve instantly for retry tests
      vi.spyOn(RealMetaAdsProvider.prototype as unknown as { delay: (ms: number) => Promise<void> }, "delay")
        .mockResolvedValue(undefined);
    });

    it("throws MetaRateLimitError for code 17", async () => {
      mockFetch.mockResolvedValue(jsonResponse(
        { error: { message: "Rate limited", type: "OAuthException", code: 17, error_subcode: 4 } },
        400,
      ));

      await expect(provider.getCampaign("123")).rejects.toThrow(MetaRateLimitError);
      // Should have retried 3 times + 1 original = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("throws MetaAuthError for code 190 without retry", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(
        { error: { message: "Invalid token", type: "OAuthException", code: 190, error_subcode: 463 } },
        400,
      ));

      await expect(provider.getCampaign("123")).rejects.toThrow(MetaAuthError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws MetaApiError for other error codes", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(
        { error: { message: "Invalid param", type: "OAuthException", code: 100, error_subcode: 0 } },
        400,
      ));

      await expect(provider.getCampaign("123")).rejects.toThrow(MetaApiError);
    });

    it("retries on 5xx errors", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse("Server Error", 500))
        .mockResolvedValueOnce(jsonResponse(META_CAMPAIGN_RAW));

      const campaign = await provider.getCampaign("123456");
      expect(campaign.name).toBe("Summer Sale");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  describe("healthCheck", () => {
    it("returns connected on success", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "me" }));

      const health = await provider.healthCheck();
      expect(health.status).toBe("connected");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.capabilities).toContain("ads.campaign.pause");
    });

    it("returns disconnected on failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const health = await provider.healthCheck();
      expect(health.status).toBe("disconnected");
      expect(health.error).toBe("Network error");
    });
  });
});

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------
describe("createMetaAdsProvider", () => {
  it("returns MockMetaAdsProvider for empty token", () => {
    const provider = createMetaAdsProvider({ accessToken: "", adAccountId: "act_1" });
    expect(provider).toBeInstanceOf(MockMetaAdsProvider);
  });

  it("returns MockMetaAdsProvider for mock-token", () => {
    const provider = createMetaAdsProvider({ accessToken: "mock-token", adAccountId: "act_1" });
    expect(provider).toBeInstanceOf(MockMetaAdsProvider);
  });

  it("returns MockMetaAdsProvider for short test tokens", () => {
    const provider = createMetaAdsProvider({ accessToken: "test_token", adAccountId: "act_1" });
    expect(provider).toBeInstanceOf(MockMetaAdsProvider);
  });

  it("returns RealMetaAdsProvider for long tokens", () => {
    const provider = createMetaAdsProvider({
      accessToken: "EAAxxxxxxxxxxxxxxxxxxxxxxxxx_long_token",
      adAccountId: "act_1",
    });
    expect(provider).toBeInstanceOf(RealMetaAdsProvider);
  });
});
