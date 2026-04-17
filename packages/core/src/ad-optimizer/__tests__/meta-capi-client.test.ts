// packages/core/src/ad-optimizer/__tests__/meta-capi-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { MetaCAPIClient } from "../meta-capi-client.js";

describe("MetaCAPIClient", () => {
  const mockFetch = vi.fn();
  let client: MetaCAPIClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = mockFetch;
    client = new MetaCAPIClient({
      pixelId: "pixel_123",
      accessToken: "test-token",
    });
  });

  it("dispatches event to correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });

    const result = await client.dispatchEvent({
      eventName: "Lead",
      eventTime: 1714000000,
      userData: { fbclid: "abc123" },
    });

    expect(result.eventsReceived).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/pixel_123/events",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("formats fbc parameter from fbclid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });

    await client.dispatchEvent({
      eventName: "Lead",
      eventTime: 1714000000,
      userData: { fbclid: "abc123" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.data[0].user_data.fbc).toMatch(/^fb\.1\.\d+\.abc123$/);
  });

  it("hashes email with SHA-256 lowercase trimmed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });

    await client.dispatchEvent({
      eventName: "Lead",
      eventTime: 1714000000,
      userData: { email: " User@Example.com " },
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    const expectedHash = createHash("sha256").update("user@example.com").digest("hex");
    expect(body.data[0].user_data.em).toEqual([expectedHash]);
  });

  it("hashes phone with SHA-256 digits only", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });

    await client.dispatchEvent({
      eventName: "Purchase",
      eventTime: 1714000000,
      userData: { phone: "+1 (555) 123-4567" },
      customData: { value: 100, currency: "USD" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    const expectedHash = createHash("sha256").update("15551234567").digest("hex");
    expect(body.data[0].user_data.ph).toEqual([expectedHash]);
  });

  it("sets action_source to system_generated", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });

    await client.dispatchEvent({
      eventName: "Lead",
      eventTime: 1714000000,
      userData: {},
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.data[0].action_source).toBe("system_generated");
  });

  it("throws descriptive error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: { message: "Invalid pixel ID" },
        }),
    });

    await expect(
      client.dispatchEvent({
        eventName: "Lead",
        eventTime: 1714000000,
        userData: {},
      }),
    ).rejects.toThrow("CAPI error (400): Invalid pixel ID");
  });

  it("handles non-JSON error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(
      client.dispatchEvent({
        eventName: "Lead",
        eventTime: 1714000000,
        userData: {},
      }),
    ).rejects.toThrow("CAPI error (500): Unknown error");
  });
});
