import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";
import { insightToMetrics } from "../campaign-decision.js";

// D1-4: Meta returns numerics as strings; a non-numeric sentinel ("N/A", an
// empty string, a malformed payload) makes parseFloat/parseInt yield NaN. A
// NaN flows through safeDivide into insightToMetrics and every cpa-gate reads
// it as false silently, voiding a recommendation
// (feedback_nan_blind_comparison_gates, #939). Each mapper must coerce a
// non-finite parse to an honest 0, never NaN, symmetric with the already-correct
// action-denominator guard in meta-campaign-insights-provider.ts.
describe("MetaAdsClient numeric finite-guards for external Meta numbers (D1-4)", () => {
  let client: MetaAdsClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    vi.useFakeTimers();
    client = new MetaAdsClient({ accessToken: "test-token", accountId: "act_123456" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mapCampaignInsight coerces non-numeric Meta fields to finite 0, never NaN", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              campaign_id: "c1",
              spend: "N/A",
              conversions: "oops",
              revenue: "",
              impressions: "not-a-number",
              inline_link_clicks: "x",
              frequency: "N/A",
              cpm: "N/A",
              inline_link_click_ctr: "N/A",
              cost_per_inline_link_click: "N/A",
            },
          ],
        }),
    });

    const rows = await client.getCampaignInsights({
      dateRange: { since: "2026-05-01", until: "2026-05-07" },
      fields: ["campaign_id", "spend", "conversions"],
    });

    const row = rows[0]!;
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
      }
    }
    // A non-numeric parse coerces to the honest 0 (no false high-CPA, no false
    // burn), not NaN (which would void every downstream comparison gate).
    expect(row.spend).toBe(0);
    expect(row.conversions).toBe(0);
    expect(row.impressions).toBe(0);
  });

  it("mapAdSetInsight coerces a non-numeric spend to finite 0 while preserving valid numbers", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ adset_id: "a1", campaign_id: "c1", spend: "N/A", conversions: "12" }],
        }),
    });

    const rows = await client.getAdSetInsights({
      dateRange: { since: "2026-05-01", until: "2026-05-07" },
      fields: ["spend"],
      campaignId: "c1",
    });

    const row = rows[0]!;
    expect(Number.isFinite(row.spend)).toBe(true);
    expect(row.spend).toBe(0);
    expect(row.conversions).toBe(12); // a valid number is untouched
  });

  it("getAccountSummary returns finite totals on a garbage insights payload", async () => {
    // Three sequential gets: metadata, then insights, then campaigns.
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "act_123456", name: "A", currency: "USD" }),
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ spend: "oops", impressions: "x", clicks: "y" }] }),
    });
    fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });

    const summaryPromise = client.getAccountSummary();
    // Advance past the 60s rate limiter between the second and third gets.
    await vi.advanceTimersByTimeAsync(61000);
    await vi.advanceTimersByTimeAsync(61000);
    const summary = await summaryPromise;

    expect(Number.isFinite(summary.totalSpend)).toBe(true);
    expect(summary.totalSpend).toBe(0);
    expect(Number.isFinite(summary.totalImpressions)).toBe(true);
    expect(Number.isFinite(summary.totalClicks)).toBe(true);
  });

  it("seam: a garbage Meta row maps to a finite cpa through insightToMetrics (never NaN voids a gate)", async () => {
    // Producer -> consumer seam pin (feedback_per_slice_review_misses_cross_slice_seams):
    // the REAL mapper output flows into the REAL insightToMetrics. cpa is
    // safeDivide(spend, conversions); a NaN spend would make cpa NaN and every
    // `cpa > k*target` gate read false, silently voiding a recommendation.
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ campaign_id: "c1", spend: "N/A", conversions: "3", impressions: "1000" }],
        }),
    });

    const rows = await client.getCampaignInsights({
      dateRange: { since: "2026-05-01", until: "2026-05-07" },
      fields: ["campaign_id", "spend", "conversions"],
    });

    const metrics = insightToMetrics(rows[0]!);
    for (const [key, value] of Object.entries(metrics)) {
      expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
    }
    expect(metrics.cpa).toBe(0); // spend 0 / conversions 3 = 0, not NaN
  });
});
