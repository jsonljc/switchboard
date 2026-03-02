import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpApiClient } from "../api-client.js";

// ── Helpers ────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("McpApiClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    // Make setTimeout execute immediately so retries don't hang
    vi.spyOn(global, "setTimeout").mockImplementation((fn: any) => {
      fn();
      return 0 as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────────────

  it("strips trailing slash from baseUrl", () => {
    const client = new McpApiClient({ baseUrl: "https://api.example.com/" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    // Use a GET call to verify the URL is constructed without double slashes
    client.get("/health");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/health",
      expect.any(Object),
    );
  });

  // ── idempotencyKey ─────────────────────────────────────────────────

  it("idempotencyKey returns {prefix}_{uuid} format", () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    const key = client.idempotencyKey("test");
    expect(key).toMatch(/^test_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("idempotencyKey uses default prefix 'mcp'", () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    const key = client.idempotencyKey();
    expect(key).toMatch(/^mcp_/);
  });

  // ── GET ────────────────────────────────────────────────────────────

  it("get() calls fetch with GET and returns { status, data }", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost:3000" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [1, 2] }));

    const result = await client.get("/api/things");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/things",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({ status: 200, data: { items: [1, 2] } });
  });

  // ── POST ───────────────────────────────────────────────────────────

  it("post() calls fetch with POST, JSON body, and idempotency key header", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost:3000" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "abc" }, 201));

    const result = await client.post("/api/items", { name: "Widget" }, "idem_123");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Widget" }),
        headers: expect.objectContaining({
          "Idempotency-Key": "idem_123",
        }),
      }),
    );
    expect(result).toEqual({ status: 201, data: { id: "abc" } });
  });

  // ── PUT ────────────────────────────────────────────────────────────

  it("put() calls fetch with PUT and JSON body", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost:3000" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ updated: true }));

    const result = await client.put("/api/items/1", { name: "Gadget" });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/items/1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Gadget" }),
      }),
    );
    expect(result).toEqual({ status: 200, data: { updated: true } });
  });

  // ── Headers ────────────────────────────────────────────────────────

  it("includes Content-Type: application/json on every request", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.get("/test");

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders["Content-Type"]).toBe("application/json");
  });

  it("includes Authorization: Bearer {apiKey} when apiKey is set", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost", apiKey: "secret-key" });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.get("/test");

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders["Authorization"]).toBe("Bearer secret-key");
  });

  it("omits Authorization header when apiKey is not set", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.get("/test");

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders["Authorization"]).toBeUndefined();
  });

  // ── Retry Logic ────────────────────────────────────────────────────

  it("retries on 429 up to 3 times", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const result = await client.get("/test");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ status: 200, data: { ok: true } });
  });

  it("retries on 500 up to 3 times", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }, 200));

    const result = await client.get("/test");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ status: 200, data: { recovered: true } });
  });

  it("does not retry on 400 — returns immediately", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400));

    const result = await client.get("/test");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 400, data: { error: "bad request" } });
  });

  it("throws after exhausting retries on persistent 500", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(client.get("/test")).rejects.toThrow("HTTP 500");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retries on network errors", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const result = await client.get("/test");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 200, data: { ok: true } });
  });

  it("throws after exhausting retries on persistent network errors", async () => {
    const client = new McpApiClient({ baseUrl: "http://localhost" });
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(client.get("/test")).rejects.toThrow("ECONNRESET");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
