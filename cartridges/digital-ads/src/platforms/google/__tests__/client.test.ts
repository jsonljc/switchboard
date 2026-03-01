import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoogleAdsClient } from "../client.js";
import { commerceFunnel } from "../funnels/commerce.js";
import type { GoogleAdsResponse, GoogleAdsRow } from "../types.js";
import type { TimeRange } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIME_RANGE: TimeRange = { since: "2024-01-01", until: "2024-01-07" };
const CUSTOMER_ID = "123-456-7890";

function makeClient(overrides: Record<string, unknown> = {}) {
  return new GoogleAdsClient({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    developerToken: "test-dev-token",
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

function errorResponse(
  code: number,
  message: string,
  status: string,
  httpStatus = 400,
): Response {
  return {
    ok: false,
    status: httpStatus,
    statusText: "Bad Request",
    json: () => Promise.resolve({ error: { code, message, status } }),
    text: () => Promise.resolve(JSON.stringify({ error: { code, message, status } })),
  } as unknown as Response;
}

function tokenResponse(expiresIn = 3600): Response {
  return okResponse({
    access_token: "fresh-access-token",
    expires_in: expiresIn,
    token_type: "Bearer",
  });
}

function makeRow(overrides: Partial<GoogleAdsRow["metrics"]> = {}): GoogleAdsRow {
  return {
    metrics: {
      impressions: "10000",
      clicks: "500",
      costMicros: "50000000", // $50
      conversions: 25,
      conversionsValue: 1250,
      allConversions: 30,
      ...overrides,
    },
  };
}

function searchStreamResponse(rows: GoogleAdsRow[]): GoogleAdsResponse[] {
  return [{ results: rows }];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoogleAdsClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2024-01-15T00:00:00Z") });
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // OAuth2
  // -----------------------------------------------------------------------

  describe("OAuth2", () => {
    it("fetches access token on first call", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      // First call should be the OAuth2 token request
      const tokenCall = fetchMock.mock.calls[0];
      expect(tokenCall[0]).toBe("https://oauth2.googleapis.com/token");
      expect(tokenCall[1].method).toBe("POST");
    });

    it("caches token for subsequent calls", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse(3600))
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])))
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);
      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      // Only one token fetch despite two API calls
      const tokenCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes("oauth2"),
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it("refreshes token when near expiry", async () => {
      const client = makeClient();
      // First token with short expiry
      fetchMock
        .mockResolvedValueOnce(tokenResponse(90)) // expires in 90s, buffer is 60s → only 30s valid
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      // Advance time past the token validity window (90s - 60s buffer = 30s)
      vi.advanceTimersByTime(31000);

      fetchMock
        .mockResolvedValueOnce(tokenResponse(3600))
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      // Two token fetches total
      const tokenCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes("oauth2"),
      );
      expect(tokenCalls).toHaveLength(2);
    });

    it("throws on token refresh failure", async () => {
      const client = makeClient({ maxRetries: 0 });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("invalid_grant"),
      } as unknown as Response);

      await expect(
        client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel),
      ).rejects.toThrow("OAuth2 token refresh failed");
    });
  });

  // -----------------------------------------------------------------------
  // Normalization
  // -----------------------------------------------------------------------

  describe("normalization", () => {
    it("returns emptySnapshot for empty response", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      const snap = await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.spend).toBe(0);
      expect(snap.topLevel).toEqual({});
      for (const stage of commerceFunnel.stages) {
        expect(snap.stages[stage.metric]).toEqual({ count: 0, cost: null });
      }
    });

    it("converts costMicros by dividing by 1,000,000", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          okResponse(searchStreamResponse([makeRow({ costMicros: "123456789" })])),
        );

      const snap = await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.spend).toBeCloseTo(123.456789);
    });

    it("maps correct stage metrics", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([makeRow()])));

      const snap = await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.stages.impressions.count).toBe(10000);
      expect(snap.stages.clicks.count).toBe(500);
      expect(snap.stages.conversions.count).toBe(25);
    });

    it("computes derived topLevel fields", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([makeRow()])));

      const snap = await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      // CPM = (50 / 10000) * 1000 = 5
      expect(snap.topLevel.cpm).toBeCloseTo(5);
      // CTR = (500 / 10000) * 100 = 5
      expect(snap.topLevel.ctr).toBeCloseTo(5);
      // CPC = 50 / 500 = 0.1
      expect(snap.topLevel.cpc).toBeCloseTo(0.1);
      // cost_per_conversion = 50 / 25 = 2
      expect(snap.topLevel.cost_per_conversion).toBeCloseTo(2);
      // ROAS = 1250 / 50 = 25
      expect(snap.topLevel.roas).toBeCloseTo(25);
    });

    it("does not compute derived fields when denominators are zero", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          okResponse(
            searchStreamResponse([
              makeRow({
                impressions: "0",
                clicks: "0",
                costMicros: "0",
                conversions: 0,
                conversionsValue: 0,
              }),
            ]),
          ),
        );

      const snap = await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      expect(snap.topLevel.cpm).toBeUndefined();
      expect(snap.topLevel.ctr).toBeUndefined();
      expect(snap.topLevel.cpc).toBeUndefined();
      expect(snap.topLevel.cost_per_conversion).toBeUndefined();
      expect(snap.topLevel.roas).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // API behavior
  // -----------------------------------------------------------------------

  describe("API behavior", () => {
    it("strips dashes from customer ID", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot("123-456-7890", "campaign", TIME_RANGE, commerceFunnel);

      const apiUrl = fetchMock.mock.calls[1][0] as string;
      expect(apiUrl).toContain("/customers/1234567890/");
      expect(apiUrl).not.toContain("123-456-7890");
    });

    it("includes loginCustomerId header when set", async () => {
      const client = makeClient({ loginCustomerId: "999-888-7777" });
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      const apiCall = fetchMock.mock.calls[1];
      expect(apiCall[1].headers["login-customer-id"]).toBe("999-888-7777");
    });

    it("omits loginCustomerId header when not set", async () => {
      const client = makeClient();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

      await client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);

      const apiCall = fetchMock.mock.calls[1];
      expect(apiCall[1].headers["login-customer-id"]).toBeUndefined();
    });

    it("builds correct GAQL query per entity level", async () => {
      for (const [level, resource] of [
        ["campaign", "campaign"],
        ["adset", "ad_group"],
        ["ad", "ad_group_ad"],
        ["account", "customer"],
      ] as const) {
        // Fresh client per iteration so OAuth token state doesn't interfere
        const client = makeClient();
        fetchMock.mockReset();
        fetchMock
          .mockResolvedValueOnce(tokenResponse())
          .mockResolvedValueOnce(okResponse(searchStreamResponse([])));

        await client.fetchSnapshot(CUSTOMER_ID, level, TIME_RANGE, commerceFunnel);

        const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
        expect(body.query).toContain(`FROM ${resource}`);
        expect(body.query).toContain(
          `WHERE segments.date BETWEEN '${TIME_RANGE.since}' AND '${TIME_RANGE.until}'`,
        );
      }
    });

    it("retries on UNAVAILABLE status", async () => {
      const client = makeClient({ maxRetries: 2 });
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(errorResponse(503, "Service unavailable", "UNAVAILABLE", 503))
        .mockResolvedValueOnce(okResponse(searchStreamResponse([makeRow()])));

      const promise = client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);
      await vi.advanceTimersByTimeAsync(2000);
      const snap = await promise;

      expect(snap.stages.impressions.count).toBe(10000);
      // Token fetch + failed attempt + successful attempt = 3
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("retries on RESOURCE_EXHAUSTED status", async () => {
      const client = makeClient({ maxRetries: 2 });
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          errorResponse(429, "Too many requests", "RESOURCE_EXHAUSTED", 429),
        )
        .mockResolvedValueOnce(okResponse(searchStreamResponse([makeRow()])));

      const promise = client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel);
      await vi.advanceTimersByTimeAsync(2000);
      const snap = await promise;

      expect(snap.stages.impressions.count).toBe(10000);
    });

    it("throws on non-retryable errors", async () => {
      const client = makeClient({ maxRetries: 0 });
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          errorResponse(403, "Permission denied", "PERMISSION_DENIED", 403),
        );

      await expect(
        client.fetchSnapshot(CUSTOMER_ID, "campaign", TIME_RANGE, commerceFunnel),
      ).rejects.toThrow("Google Ads API error 403");
    });
  });
});
