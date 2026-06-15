// packages/ad-optimizer/src/__tests__/meta-ads-client-retry.test.ts
//
// PR 1.3 (D2-5): 429/Retry-After classification + bounded backoff on GET.
// Split out from meta-ads-client.test.ts (near the eslint max-lines cap).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsClient, RateLimitError } from "../meta-ads-client.js";

/**
 * A Headers-like stub returning `value` for `retry-after` (case-insensitive),
 * `null` otherwise, matching the `Number.isFinite`-guarded read in handleResponse.
 */
function headersWith(retryAfter: string | null) {
  return {
    get: (h: string) => (h.toLowerCase() === "retry-after" ? retryAfter : null),
  };
}

describe("MetaAdsClient 429 classification + bounded backoff (GET)", () => {
  let client: MetaAdsClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    vi.useFakeTimers();
    client = new MetaAdsClient({ accessToken: "test-token", accountId: "act_123456" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("throws RateLimitError with retryAfterSeconds after exhausting retries on a persistent 429", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: headersWith("1"),
      json: () =>
        Promise.resolve({ error: { message: "rate limited", type: "OAuthException", code: 17 } }),
    });

    const p = client.getCampaignInsights({
      dateRange: { since: "2024-01-01", until: "2024-01-31" },
      fields: ["impressions"],
    });
    // Surface rejection without an unhandled-rejection warning while timers advance.
    const settled = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBe(1);
    // 1 initial attempt + MAX_RATE_LIMIT_RETRIES (2) = 3 fetches.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries a 429-then-200 GET and succeeds (fetch called twice)", async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: headersWith("1"),
        json: () => Promise.resolve({ error: { message: "rate limited", type: "x", code: 17 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: headersWith(null),
        json: () => Promise.resolve({ data: [{ campaign_id: "c_1", spend: "10" }] }),
      });

    const p = client.getCampaignInsights({
      dateRange: { since: "2024-01-01", until: "2024-01-31" },
      fields: ["impressions"],
    });
    await vi.runAllTimersAsync();
    const rows = await p;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.campaignId).toBe("c_1");
  });

  it("keeps a non-throttle 400 as a terminal Error (no retry, not a RateLimitError)", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      headers: headersWith(null),
      json: () =>
        Promise.resolve({ error: { message: "Invalid parameter", type: "x", code: 100 } }),
    });

    const p = client.getCampaignInsights({
      dateRange: { since: "2024-01-01", until: "2024-01-31" },
      fields: ["impressions"],
    });
    const settled = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toMatch(/Meta API error \(400\)/);
    // Terminal on the first attempt: no retry.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
