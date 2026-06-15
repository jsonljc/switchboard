import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";

// listCampaigns rolls up account ad sets by campaign (destination_type is an ad-set
// property). Two internal GETs (adsets entity + adset insights), so fake-timer past
// the 60s limiter between them, mirroring meta-ads-client-adset-learning.test.ts.
describe("listCampaigns", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockTwoGet(entityData: unknown[], insightData: unknown[]) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: entityData }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: insightData }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("rolls ad sets up to campaigns: sums spend, one row per campaign", async () => {
    mockTwoGet(
      [
        {
          id: "as_1",
          campaign_id: "c_1",
          destination_type: "WHATSAPP",
          learning_stage_info: { status: "SUCCESS" },
        },
        {
          id: "as_2",
          campaign_id: "c_1",
          destination_type: "WHATSAPP",
          learning_stage_info: { status: "SUCCESS" },
        },
        {
          id: "as_3",
          campaign_id: "c_2",
          destination_type: "ON_AD",
          learning_stage_info: { status: "SUCCESS" },
        },
        {
          id: "as_4",
          campaign_id: "c_3",
          destination_type: "WEBSITE",
          learning_stage_info: { status: "SUCCESS" },
        },
      ],
      [
        { adset_id: "as_1", spend: "200", conversions: "1", frequency: "1.1" },
        { adset_id: "as_2", spend: "100", conversions: "1", frequency: "1.1" },
        { adset_id: "as_3", spend: "50", conversions: "1", frequency: "1.1" },
        { adset_id: "as_4", spend: "300", conversions: "1", frequency: "1.1" },
      ],
    );
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const rowsPromise = client.listCampaigns({ orgId: "o1", accountId: "act_1" });
    await vi.advanceTimersByTimeAsync(61000);
    const rows = await rowsPromise;

    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: "c_1", destination_type: "WHATSAPP", spend: 300 },
        { id: "c_2", destination_type: "ON_AD", spend: 50 },
        { id: "c_3", destination_type: "WEBSITE", spend: 300 },
      ]),
    );
  });

  it("splits a mixed-destination campaign into one row per destination (no inflation)", async () => {
    mockTwoGet(
      [
        {
          id: "as_1",
          campaign_id: "c_1",
          destination_type: "WHATSAPP",
          learning_stage_info: { status: "SUCCESS" },
        },
        {
          id: "as_2",
          campaign_id: "c_1",
          destination_type: "WEBSITE",
          learning_stage_info: { status: "SUCCESS" },
        },
      ],
      [
        { adset_id: "as_1", spend: "90", conversions: "1", frequency: "1.1" },
        { adset_id: "as_2", spend: "10", conversions: "1", frequency: "1.1" },
      ],
    );
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const rowsPromise = client.listCampaigns({ orgId: "o1", accountId: "act_1" });
    await vi.advanceTimersByTimeAsync(61000);
    const rows = await rowsPromise;

    // WEBSITE spend stays on web, NOT credited to ctwa: the coverage gate is not inflated.
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: "c_1", destination_type: "WHATSAPP", spend: 90 },
        { id: "c_1", destination_type: "WEBSITE", spend: 10 },
      ]),
    );
  });

  it("emits an empty destination_type when Meta returns an ad set without one (validator then skips it)", async () => {
    mockTwoGet(
      [{ id: "as_1", campaign_id: "c_1", learning_stage_info: { status: "SUCCESS" } }],
      [{ adset_id: "as_1", spend: "40", conversions: "1", frequency: "1.1" }],
    );
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const rowsPromise = client.listCampaigns({ orgId: "o1", accountId: "act_1" });
    await vi.advanceTimersByTimeAsync(61000);
    const rows = await rowsPromise;

    expect(rows).toEqual([{ id: "c_1", destination_type: "", spend: 40 }]);
  });
});
