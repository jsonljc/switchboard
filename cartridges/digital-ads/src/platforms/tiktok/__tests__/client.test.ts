import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TikTokAdsClient } from "../client.js";
import { commerceFunnel } from "../funnels/commerce.js";
import type { TikTokReportResponse, TikTokReportRow } from "../types.js";
import type { TimeRange } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIME_RANGE: TimeRange = { since: "2024-01-01", until: "2024-01-07" };
const ADVERTISER_ID = "7000000000";

function makeClient(overrides: Record<string, unknown> = {}) {
  return new TikTokAdsClient({
    accessToken: "test-access-token",
    appId: "test-app-id",
    maxRetries: 1,
    ...overrides,
  });
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function httpErrorResponse(httpStatus: number, text: string): Response {
  return {
    ok: false,
    status: httpStatus,
    statusText: "Error",
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function makeRow(metricOverrides: Partial<TikTokReportRow["metrics"]> = {}): TikTokReportRow {
  return {
    dimensions: { stat_time_day: "2024-01-01" },
    metrics: {
      spend: "100.50",
      impressions: "10000",
      clicks: "500",
      ctr: "5.0",
      cpc: "0.201",
      cpm: "10.05",
      page_browse: "300",
      onsite_add_to_cart: "80",
      complete_payment: "20",
      complete_payment_value: "1500.00",
      conversion: "25",
      form_submit: "15",
      onsite_form: "10",
      ...metricOverrides,
    },
  };
}

function reportResponse(
  rows: TikTokReportRow[],
  pageInfo?: TikTokReportResponse["data"]["page_info"],
): TikTokReportResponse {
  return {
    code: 0,
    message: "OK",
    data: {
      list: rows,
      page_info: pageInfo,
    },
  };
}

function apiError(code: number, message: string): TikTokReportResponse {
  return {
    code,
    message,
    data: { list: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TikTokAdsClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Normalization
  // -----------------------------------------------------------------------

  describe("normalization", () => {
    it("returns emptySnapshot for empty response", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([])));

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      expect(snap.spend).toBe(0);
      expect(snap.topLevel).toEqual({});
      for (const stage of commerceFunnel.stages) {
        expect(snap.stages[stage.metric]).toEqual({ count: 0, cost: null });
      }
    });

    it("parses string metric values correctly", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([makeRow()])));

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      expect(snap.spend).toBeCloseTo(100.5); // parseFloat
      expect(snap.stages.impressions.count).toBe(10000); // parseInt
      expect(snap.stages.clicks.count).toBe(500); // parseInt
      expect(snap.stages.page_browse.count).toBe(300); // parseInt
      expect(snap.stages.onsite_add_to_cart.count).toBe(80); // parseInt
      expect(snap.stages.complete_payment.count).toBe(20); // parseInt
    });

    it("resolves all metricMap keys correctly", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([makeRow()])));

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      // Verify all commerce funnel stages are mapped
      expect(snap.stages.impressions.count).toBe(10000);
      expect(snap.stages.clicks.count).toBe(500);
      expect(snap.stages.page_browse.count).toBe(300);
      expect(snap.stages.onsite_add_to_cart.count).toBe(80);
      expect(snap.stages.complete_payment.count).toBe(20);
    });

    it("uses generic cost-per-action fallback (spend/count) for non-cpm/cpc cost metrics", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([makeRow()])));

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      // onsite_add_to_cart costMetric = "onsite_add_to_cart" → generic fallback: spend / count
      // 100.50 / 80 = 1.25625
      expect(snap.stages.onsite_add_to_cart.cost).toBeCloseTo(100.5 / 80);
      // complete_payment costMetric = "complete_payment" → generic fallback: spend / count
      // 100.50 / 20 = 5.025
      expect(snap.stages.complete_payment.cost).toBeCloseTo(100.5 / 20);
    });

    it("computes derived topLevel fields (CPM, CTR, CPC, cost_per_complete_payment, ROAS)", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([makeRow()])));

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      // CPM = (100.50 / 10000) * 1000 = 10.05
      expect(snap.topLevel.cpm).toBeCloseTo(10.05);
      // CTR = (500 / 10000) * 100 = 5.0
      expect(snap.topLevel.ctr).toBeCloseTo(5.0);
      // CPC = 100.50 / 500 = 0.201
      expect(snap.topLevel.cpc).toBeCloseTo(0.201);
      // cost_per_complete_payment = 100.50 / 20 = 5.025
      expect(snap.topLevel.cost_per_complete_payment).toBeCloseTo(5.025);
      // ROAS = 1500 / 100.50 = 14.925...
      expect(snap.topLevel.roas).toBeCloseTo(1500 / 100.5);
    });

    it("does not compute derived fields when denominators are zero", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          reportResponse([
            makeRow({
              spend: "0",
              impressions: "0",
              clicks: "0",
              complete_payment: "0",
              complete_payment_value: "0",
            }),
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      expect(snap.topLevel.cpm).toBeUndefined();
      expect(snap.topLevel.ctr).toBeUndefined();
      expect(snap.topLevel.cpc).toBeUndefined();
      expect(snap.topLevel.cost_per_complete_payment).toBeUndefined();
      expect(snap.topLevel.roas).toBeUndefined();
    });

    it("aggregates across multiple rows", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          reportResponse([
            makeRow({
              spend: "100",
              impressions: "5000",
              clicks: "200",
              complete_payment: "10",
              complete_payment_value: "500",
            }),
            makeRow({
              spend: "150",
              impressions: "7000",
              clicks: "350",
              complete_payment: "15",
              complete_payment_value: "800",
            }),
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      expect(snap.spend).toBeCloseTo(250);
      expect(snap.stages.impressions.count).toBe(12000);
      expect(snap.stages.clicks.count).toBe(550);
      expect(snap.stages.complete_payment.count).toBe(25);
    });
  });

  // -----------------------------------------------------------------------
  // API behavior
  // -----------------------------------------------------------------------

  describe("API behavior", () => {
    it("maps entity levels to AUCTION_* data levels", async () => {
      const client = makeClient();

      for (const [level, dataLevel] of [
        ["campaign", "AUCTION_CAMPAIGN"],
        ["adset", "AUCTION_ADGROUP"],
        ["ad", "AUCTION_AD"],
        ["account", "AUCTION_ADVERTISER"],
      ] as const) {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(okResponse(reportResponse([])));

        await client.fetchSnapshot(ADVERTISER_ID, level, TIME_RANGE, commerceFunnel);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.data_level).toBe(dataLevel);
      }
    });

    it("treats code === 0 as success", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([makeRow()])));

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      // Should not throw and should return data
      expect(snap.stages.impressions.count).toBe(10000);
    });

    it("paginates via page_info (increments page, stops at total_page)", async () => {
      const client = makeClient();

      fetchMock
        .mockResolvedValueOnce(
          okResponse(
            reportResponse(
              [makeRow({ spend: "100", impressions: "5000", clicks: "200" })],
              { page: 1, page_size: 1, total_number: 2, total_page: 2 },
            ),
          ),
        )
        .mockResolvedValueOnce(
          okResponse(
            reportResponse(
              [makeRow({ spend: "150", impressions: "6000", clicks: "300" })],
              { page: 2, page_size: 1, total_number: 2, total_page: 2 },
            ),
          ),
        );

      const snap = await client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Verify page increments
      const body1 = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const body2 = JSON.parse(fetchMock.mock.calls[1][1].body as string);
      expect(body1.page).toBe(1);
      expect(body2.page).toBe(2);
      // Verify aggregation
      expect(snap.spend).toBeCloseTo(250);
      expect(snap.stages.impressions.count).toBe(11000);
    });

    it("uses Access-Token header (not Authorization: Bearer)", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([])));

      await client.fetchSnapshot(ADVERTISER_ID, "campaign", TIME_RANGE, commerceFunnel);

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers["Access-Token"]).toBe("test-access-token");
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("retries on rate limit code 40100", async () => {
      const client = makeClient({ maxRetries: 2 });

      fetchMock
        .mockResolvedValueOnce(okResponse(apiError(40100, "Rate limit")))
        .mockResolvedValueOnce(okResponse(reportResponse([makeRow()])));

      const promise = client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );
      await vi.advanceTimersByTimeAsync(2000);
      const snap = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(snap.stages.impressions.count).toBe(10000);
    });

    it("retries on server error code >= 50000", async () => {
      const client = makeClient({ maxRetries: 2 });

      fetchMock
        .mockResolvedValueOnce(okResponse(apiError(50001, "Internal server error")))
        .mockResolvedValueOnce(okResponse(reportResponse([makeRow()])));

      const promise = client.fetchSnapshot(
        ADVERTISER_ID,
        "campaign",
        TIME_RANGE,
        commerceFunnel,
      );
      await vi.advanceTimersByTimeAsync(2000);
      const snap = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(snap.stages.impressions.count).toBe(10000);
    });

    it("throws on non-retryable errors", async () => {
      const client = makeClient({ maxRetries: 0 });
      fetchMock.mockResolvedValue(okResponse(apiError(40001, "Invalid parameter")));

      await expect(
        client.fetchSnapshot(ADVERTISER_ID, "campaign", TIME_RANGE, commerceFunnel),
      ).rejects.toThrow("TikTok API error 40001");
    });

    it("throws on HTTP-level errors", async () => {
      const client = makeClient({ maxRetries: 0 });
      fetchMock.mockResolvedValue(httpErrorResponse(500, "Internal Server Error"));

      await expect(
        client.fetchSnapshot(ADVERTISER_ID, "campaign", TIME_RANGE, commerceFunnel),
      ).rejects.toThrow("TikTok API HTTP error 500");
    });

    it("sends correct request body structure", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(reportResponse([])));

      await client.fetchSnapshot(ADVERTISER_ID, "campaign", TIME_RANGE, commerceFunnel);

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/report/integrated/get/");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.advertiser_id).toBe(ADVERTISER_ID);
      expect(body.report_type).toBe("BASIC");
      expect(body.dimensions).toEqual(["stat_time_day"]);
      expect(body.start_date).toBe("2024-01-01");
      expect(body.end_date).toBe("2024-01-07");
    });
  });
});
