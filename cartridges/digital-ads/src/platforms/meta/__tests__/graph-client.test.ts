import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaGraphClient } from "../graph-client.js";
import { MetaApiError, MetaRateLimitError, MetaAuthError } from "../errors.js";
import { CircuitBreakerOpenError } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(overrides: Partial<ConstructorParameters<typeof MetaGraphClient>[0]> = {}) {
  return new MetaGraphClient({
    accessToken: "test-token-1234567890",
    maxRetries: 1, // keep tests fast
    maxRequestsPerSecond: 100, // don't throttle in tests
    ...overrides,
  });
}

function okResponse(body: unknown, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  return {
    ok: true,
    status: 200,
    headers: h,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse(code: number, message: string, httpStatus = 400, subcode = 0): Response {
  return {
    ok: false,
    status: httpStatus,
    statusText: "Bad Request",
    headers: new Headers(),
    json: () =>
      Promise.resolve({
        error: { message, type: "OAuthException", code, error_subcode: subcode },
      }),
    text: () =>
      Promise.resolve(
        JSON.stringify({
          error: { message, type: "OAuthException", code, error_subcode: subcode },
        }),
      ),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetaGraphClient", () => {
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
  // Bearer auth
  // -----------------------------------------------------------------------

  describe("authentication", () => {
    it("sends Authorization: Bearer header, not query param", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse({ id: "123" }));

      await client.request("me");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).not.toContain("access_token=");
      const headers = init.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer test-token-1234567890");
    });
  });

  // -----------------------------------------------------------------------
  // URL construction
  // -----------------------------------------------------------------------

  describe("URL construction", () => {
    it("defaults to v22.0 API version", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse({}));

      await client.request("me");

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("graph.facebook.com/v22.0/me");
    });

    it("accepts custom API version", async () => {
      const client = makeClient({ apiVersion: "v19.0" });
      fetchMock.mockResolvedValue(okResponse({}));

      await client.request("me");

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("graph.facebook.com/v19.0/me");
    });

    it("appends params as query string", async () => {
      const client = makeClient();
      fetchMock.mockResolvedValue(okResponse({}));

      await client.request("me", { params: { fields: "id,name" } });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("fields=id%2Cname");
    });
  });

  // -----------------------------------------------------------------------
  // Error mapping
  // -----------------------------------------------------------------------

  describe("error mapping", () => {
    it("throws MetaAuthError on code 190 — no retry", async () => {
      const client = makeClient({ maxRetries: 2 });
      fetchMock.mockResolvedValue(errorResponse(190, "Invalid access token"));

      await expect(client.request("me")).rejects.toThrow(MetaAuthError);
      // Should only be called once (no retry)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws MetaRateLimitError on code 17", async () => {
      const client = makeClient({ maxRetries: 0 });
      fetchMock.mockResolvedValue(errorResponse(17, "Too many calls"));

      await expect(client.request("me")).rejects.toThrow(MetaRateLimitError);
    });

    it("throws MetaApiError on unknown error codes", async () => {
      const client = makeClient({ maxRetries: 0 });
      fetchMock.mockResolvedValue(errorResponse(100, "Invalid parameter"));

      await expect(client.request("me")).rejects.toThrow(MetaApiError);
    });
  });

  // -----------------------------------------------------------------------
  // Retry behavior
  // -----------------------------------------------------------------------

  describe("retry behavior", () => {
    it("retries on rate limit error (code 17)", async () => {
      const client = makeClient({ maxRetries: 1 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(17, "Rate limited"))
        .mockResolvedValueOnce(okResponse({ success: true }));

      const promise = client.request("me");
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result).toEqual({ success: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries on transient error (code 2)", async () => {
      const client = makeClient({ maxRetries: 1 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(2, "Temporary error"))
        .mockResolvedValueOnce(okResponse({ ok: true }));

      const promise = client.request("me");
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries on transient error (code 32)", async () => {
      const client = makeClient({ maxRetries: 1 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(32, "Transient"))
        .mockResolvedValueOnce(okResponse({ done: true }));

      const promise = client.request("me");
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result).toEqual({ done: true });
    });

    it("throws after retry exhaustion", async () => {
      const client = makeClient({ maxRetries: 1 });

      fetchMock
        .mockResolvedValueOnce(errorResponse(2, "Transient error"))
        .mockResolvedValueOnce(errorResponse(2, "Transient error"));

      const promise = client.request("me");
      const assertion = expect(promise).rejects.toThrow(MetaApiError);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    });
  });

  // -----------------------------------------------------------------------
  // Circuit breaker
  // -----------------------------------------------------------------------

  describe("circuit breaker", () => {
    it("reports circuit state", () => {
      const client = makeClient();
      expect(client.getCircuitState()).toBe("closed");
    });

    it("opens circuit after 5 consecutive failures", async () => {
      const client = makeClient({ maxRetries: 0 });

      // 5 consecutive failures to trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        fetchMock.mockResolvedValueOnce(errorResponse(100, "Bad request"));
        try {
          await client.request("me");
        } catch {
          // expected
        }
      }

      // 6th call should get CircuitBreakerOpenError without hitting fetch
      fetchMock.mockClear();
      await expect(client.request("me")).rejects.toThrow(CircuitBreakerOpenError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------

  describe("requestPaginated", () => {
    it("follows paging.next cursor links", async () => {
      const client = makeClient();

      fetchMock
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "1" }],
            paging: { next: "https://graph.facebook.com/v22.0/next-page" },
          }),
        )
        .mockResolvedValueOnce(
          okResponse({
            data: [{ id: "2" }],
          }),
        );

      const items = await client.requestPaginated("act_123/campaigns");

      expect(items).toEqual([{ id: "1" }, { id: "2" }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns single page when no paging.next", async () => {
      const client = makeClient();

      fetchMock.mockResolvedValueOnce(okResponse({ data: [{ id: "a" }, { id: "b" }] }));

      const items = await client.requestPaginated("act_123/campaigns");

      expect(items).toEqual([{ id: "a" }, { id: "b" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // x-business-use-case-usage header
  // -----------------------------------------------------------------------

  describe("usage header parsing", () => {
    it("logs warning when usage exceeds 75%", async () => {
      const client = makeClient();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      fetchMock.mockResolvedValueOnce(
        okResponse(
          { id: "123" },
          {
            "x-business-use-case-usage": JSON.stringify({
              "12345": [{ call_count: 80, total_cputime: 10, total_time: 20 }],
            }),
          },
        ),
      );

      await client.request("me");

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("High API usage for 12345"));
      warnSpy.mockRestore();
    });

    it("does not warn when usage is under 75%", async () => {
      const client = makeClient();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      fetchMock.mockResolvedValueOnce(
        okResponse(
          { id: "123" },
          {
            "x-business-use-case-usage": JSON.stringify({
              "12345": [{ call_count: 50, total_cputime: 30, total_time: 40 }],
            }),
          },
        ),
      );

      await client.request("me");

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
