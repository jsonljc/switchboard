import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaApiClient } from "../client.js";
import { commerceFunnel } from "../funnels/commerce.js";
import type { MetaInsightsResponse } from "../types.js";
import type { TimeRange } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIME_RANGE: TimeRange = { since: "2024-01-01", until: "2024-01-07" };
const ENTITY_ID = "act_123456";

function makeClient(overrides: Record<string, unknown> = {}) {
  return new MetaApiClient({
    accessToken: "test-token",
    maxRetries: 1, // keep tests fast
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

function errorResponse(code: number, message: string, httpStatus = 400): Response {
  return {
    ok: false,
    status: httpStatus,
    statusText: "Bad Request",
    json: () => Promise.resolve({ error: { message, type: "OAuthException", code } }),
    text: () => Promise.resolve(JSON.stringify({ error: { message, type: "OAuthException", code } })),
  } as unknown as Response;
}

function insightsResponse(
  data: MetaInsightsResponse["data"],
  next?: string,
): MetaInsightsResponse {
  return {
    data,
    ...(next ? { paging: { next } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetaApiClient", () => {
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
  // Config defaults
  // -----------------------------------------------------------------------

  describe("config defaults", () => {
    it("uses default apiVersion v21.0", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(insightsResponse([])));

      await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v21.0/");
    });

    it("accepts custom apiVersion", async () => {
      const client = makeClient({ apiVersion: "v19.0" });
      fetchMock.mockResolvedValue(okResponse(insightsResponse([])));

      await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v19.0/");
    });
  });

  // -----------------------------------------------------------------------
  // Normalization
  // -----------------------------------------------------------------------

  describe("normalization", () => {
    it("returns emptySnapshot for empty response", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse(insightsResponse([])));

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.spend).toBe(0);
      expect(snap.entityId).toBe(ENTITY_ID);
      expect(snap.entityLevel).toBe("campaign");
      expect(snap.periodStart).toBe("2024-01-01");
      expect(snap.periodEnd).toBe("2024-01-07");
      expect(snap.topLevel).toEqual({});

      // Every stage should have count 0, cost null
      for (const stage of commerceFunnel.stages) {
        expect(snap.stages[stage.metric]).toEqual({ count: 0, cost: null });
      }
    });

    it("normalizes single row with top-level metrics", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "100.50",
              impressions: "5000",
              inline_link_clicks: "200",
              clicks: "250",
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.spend).toBeCloseTo(100.5);
      expect(snap.stages.impressions.count).toBe(5000);
      expect(snap.stages.inline_link_clicks.count).toBe(200);
    });

    it("normalizes actions array into action-based stages", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "500",
              impressions: "10000",
              inline_link_clicks: "400",
              clicks: "500",
              actions: [
                { action_type: "landing_page_view", value: "300" },
                { action_type: "view_content", value: "200" },
                { action_type: "add_to_cart", value: "50" },
                { action_type: "purchase", value: "10" },
              ],
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.stages.landing_page_view.count).toBe(300);
      expect(snap.stages.view_content.count).toBe(200);
      expect(snap.stages.add_to_cart.count).toBe(50);
      expect(snap.stages.purchase.count).toBe(10);
    });

    it("aggregates across multiple rows", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-03",
              spend: "100",
              impressions: "5000",
              inline_link_clicks: "200",
              clicks: "250",
              actions: [{ action_type: "purchase", value: "5" }],
            },
            {
              date_start: "2024-01-04",
              date_stop: "2024-01-07",
              spend: "150",
              impressions: "6000",
              inline_link_clicks: "300",
              clicks: "350",
              actions: [{ action_type: "purchase", value: "8" }],
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.spend).toBeCloseTo(250);
      expect(snap.stages.impressions.count).toBe(11000);
      expect(snap.stages.inline_link_clicks.count).toBe(500);
      expect(snap.stages.purchase.count).toBe(13);
    });

    it("computes derived topLevel fields (CPM, CTR, CPC)", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "100",
              impressions: "10000",
              inline_link_clicks: "200",
              clicks: "300",
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      // CPM = (spend / impressions) * 1000 = (100 / 10000) * 1000 = 10
      expect(snap.topLevel.cpm).toBeCloseTo(10);
      // CTR = (inline_link_clicks / impressions) * 100 = (200 / 10000) * 100 = 2
      expect(snap.topLevel.ctr).toBeCloseTo(2);
      // CPC = spend / inline_link_clicks = 100 / 200 = 0.5
      expect(snap.topLevel.cpc).toBeCloseTo(0.5);
    });

    it("does not compute CPM/CTR/CPC when impressions/clicks are zero", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "0",
              impressions: "0",
              inline_link_clicks: "0",
              clicks: "0",
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.topLevel.cpm).toBeUndefined();
      expect(snap.topLevel.ctr).toBeUndefined();
      expect(snap.topLevel.cpc).toBeUndefined();
    });

    it("computes cost_per_action_type as spend / count", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "1000",
              impressions: "50000",
              inline_link_clicks: "1000",
              clicks: "1200",
              actions: [
                { action_type: "add_to_cart", value: "100" },
                { action_type: "purchase", value: "20" },
              ],
              cost_per_action_type: [
                { action_type: "add_to_cart", value: "10" },
                { action_type: "purchase", value: "50" },
              ],
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      // costMetricSource === "cost_per_action_type" → cost = totalSpend / count
      // add_to_cart: 1000 / 100 = 10
      expect(snap.stages.add_to_cart.cost).toBeCloseTo(10);
      // purchase: 1000 / 20 = 50
      expect(snap.stages.purchase.cost).toBeCloseTo(50);
    });

    it("resolves count via metricSource: top_level vs actions", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "100",
              impressions: "5000",
              inline_link_clicks: "200",
              clicks: "300",
              actions: [
                { action_type: "landing_page_view", value: "150" },
              ],
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      // top_level metrics
      expect(snap.stages.impressions.count).toBe(5000);
      expect(snap.stages.inline_link_clicks.count).toBe(200);
      // actions-based metrics
      expect(snap.stages.landing_page_view.count).toBe(150);
    });

    it("computes top_level cost metrics (cpm, cpc) from aggregates", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(
        okResponse(
          insightsResponse([
            {
              date_start: "2024-01-01",
              date_stop: "2024-01-07",
              spend: "200",
              impressions: "20000",
              inline_link_clicks: "400",
              clicks: "500",
            },
          ]),
        ),
      );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      // impressions stage costMetric = "cpm", costMetricSource = "top_level"
      // cpm = (spend / impressions) * 1000 = (200 / 20000) * 1000 = 10
      expect(snap.stages.impressions.cost).toBeCloseTo(10);
      // inline_link_clicks stage costMetric = "cpc", costMetricSource = "top_level"
      // cpc = spend / inline_link_clicks = 200 / 400 = 0.5
      expect(snap.stages.inline_link_clicks.cost).toBeCloseTo(0.5);
    });
  });

  // -----------------------------------------------------------------------
  // API behavior
  // -----------------------------------------------------------------------

  describe("API behavior", () => {
    it("follows paging.next to paginate", async () => {
      const client = makeClient();

      fetchMock
        .mockResolvedValueOnce(
          okResponse(
            insightsResponse(
              [
                {
                  date_start: "2024-01-01",
                  date_stop: "2024-01-03",
                  spend: "100",
                  impressions: "5000",
                  inline_link_clicks: "200",
                  clicks: "250",
                },
              ],
              "https://graph.facebook.com/v21.0/next-page",
            ),
          ),
        )
        .mockResolvedValueOnce(
          okResponse(
            insightsResponse([
              {
                date_start: "2024-01-04",
                date_stop: "2024-01-07",
                spend: "150",
                impressions: "6000",
                inline_link_clicks: "300",
                clicks: "350",
              },
            ]),
          ),
        );

      const snap = await client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe("https://graph.facebook.com/v21.0/next-page");
      expect(snap.spend).toBeCloseTo(250);
      expect(snap.stages.impressions.count).toBe(11000);
    });

    it("retries on transient error code 2 with backoff", async () => {
      const client = makeClient({ maxRetries: 2 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(2, "Temporary error"))
        .mockResolvedValueOnce(
          okResponse(
            insightsResponse([
              {
                date_start: "2024-01-01",
                date_stop: "2024-01-07",
                spend: "100",
                impressions: "5000",
                inline_link_clicks: "200",
                clicks: "250",
              },
            ]),
          ),
        );

      const promise = client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);
      // Advance timers past the backoff (2^0 * 1000 = 1000ms)
      await vi.advanceTimersByTimeAsync(2000);
      const snap = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(snap.stages.impressions.count).toBe(5000);
    });

    it("retries on rate limit error code 32", async () => {
      const client = makeClient({ maxRetries: 2 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(32, "Rate limit exceeded"))
        .mockResolvedValueOnce(
          okResponse(
            insightsResponse([
              {
                date_start: "2024-01-01",
                date_stop: "2024-01-07",
                spend: "50",
                impressions: "2000",
                inline_link_clicks: "100",
                clicks: "120",
              },
            ]),
          ),
        );

      const promise = client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);
      await vi.advanceTimersByTimeAsync(2000);
      const snap = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(snap.spend).toBeCloseTo(50);
    });

    it("throws on non-retryable API errors", async () => {
      const client = makeClient({ maxRetries: 0 });

      fetchMock.mockResolvedValue(errorResponse(190, "Invalid access token"));

      await expect(
        client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel),
      ).rejects.toThrow("Meta API error 190");
    });

    it("throws after retry exhaustion", async () => {
      const client = makeClient({ maxRetries: 1 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(2, "Temporary error"))
        .mockResolvedValueOnce(errorResponse(2, "Temporary error"));

      const promise = client.fetchSnapshot(ENTITY_ID, "campaign", TIME_RANGE, commerceFunnel);
      // Attach rejection handler before advancing timers to avoid unhandled rejection warning
      const assertion = expect(promise).rejects.toThrow("Meta API error 2");
      await vi.advanceTimersByTimeAsync(5000);

      await assertion;
    });
  });
});
