import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";

// Ad-set learning-input fetches (per-campaign + account-level) live in a focused sibling
// so meta-ads-client.test.ts stays under the 600-line ESLint cap.

describe("getAdSetLearningInputs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps entity learning_stage_info + destination_type + insights spend into AdSetLearningInput[]", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: adsets entity edge (learning_stage_info + destination_type)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "as_1",
              name: "AdSet 1",
              campaign_id: "c_1",
              destination_type: "WHATSAPP",
              learning_stage_info: { status: "LEARNING" },
            },
            {
              id: "as_2",
              name: "AdSet 2",
              campaign_id: "c_1",
              destination_type: "ON_AD",
              learning_stage_info: { status: "SUCCESS" },
            },
          ],
        }),
      })
      // 2nd call: adset insights (spend etc.)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              adset_id: "as_1",
              spend: "300",
              conversions: "2",
              frequency: "1.5",
              inline_link_click_ctr: "1.0",
            },
            {
              adset_id: "as_2",
              spend: "100",
              conversions: "5",
              frequency: "1.2",
              inline_link_click_ctr: "1.4",
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    const rowsPromise = client.getAdSetLearningInputs("c_1");

    // Advance past rate limit for the second internal call (getAdSetInsights)
    await vi.advanceTimersByTimeAsync(61000);

    const rows = await rowsPromise;

    expect(rows).toHaveLength(2);
    const as1 = rows.find((r) => r.adSetId === "as_1")!;
    expect(as1.learningStageStatus).toBe("LEARNING");
    expect(as1.spend).toBe(300);
    expect(as1.campaignId).toBe("c_1");
    expect(as1.destinationType).toBe("WHATSAPP");
    expect(rows.find((r) => r.adSetId === "as_2")!.learningStageStatus).toBe("SUCCESS");
    expect(rows.find((r) => r.adSetId === "as_2")!.destinationType).toBe("ON_AD");
    // Per-campaign edge query: destination_type fetched + scoped via filtering.
    const adsetsUrl = String(fetchMock.mock.calls[0]![0]);
    expect(adsetsUrl).toContain("destination_type");
    expect(adsetsUrl).toContain("filtering");
  });
});

describe("getAccountAdSetLearningInputs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches all account ad sets (no campaign filter) with destination_type + learning state", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: account-level adsets edge (destination_type + learning_stage_info)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "as_1",
              name: "AdSet 1",
              campaign_id: "c_1",
              destination_type: "WHATSAPP",
              learning_stage_info: { status: "SUCCESS" },
            },
            {
              id: "as_2",
              name: "AdSet 2",
              campaign_id: "c_2",
              destination_type: "ON_AD",
              learning_stage_info: { status: "FAIL" },
            },
          ],
        }),
      })
      // 2nd call: account-level adset insights
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { adset_id: "as_1", spend: "250", conversions: "5", frequency: "1.1" },
            { adset_id: "as_2", spend: "150", conversions: "3", frequency: "1.3" },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    const rowsPromise = client.getAccountAdSetLearningInputs({
      since: "2026-05-25",
      until: "2026-06-01",
    });
    await vi.advanceTimersByTimeAsync(61000);
    const rows = await rowsPromise;

    expect(rows).toHaveLength(2);
    const as1 = rows.find((r) => r.adSetId === "as_1")!;
    expect(as1.destinationType).toBe("WHATSAPP");
    expect(as1.campaignId).toBe("c_1");
    expect(as1.spend).toBe(250);
    expect(as1.learningStageStatus).toBe("SUCCESS");
    expect(rows.find((r) => r.adSetId === "as_2")!.destinationType).toBe("ON_AD");
    // Account-level edge query: destination_type fetched, NO campaign filter.
    const adsetsUrl = String(fetchMock.mock.calls[0]![0]);
    expect(adsetsUrl).toContain("destination_type");
    expect(adsetsUrl).not.toContain("filtering");
    // The paired ad-set INSIGHTS edge must page to at least the entity cap, else accounts
    // with >~25 ad sets get spend:0 for the tail and coverage silently collapses.
    const insightsUrl = String(fetchMock.mock.calls[1]![0]);
    expect(insightsUrl).toContain("/insights");
    expect(insightsUrl).toContain("limit=200");
  });
});
