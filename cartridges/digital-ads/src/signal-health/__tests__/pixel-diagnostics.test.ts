// ---------------------------------------------------------------------------
// Tests — PixelDiagnosticsChecker
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { PixelDiagnosticsChecker } from "../pixel-diagnostics.js";

const BASE_URL = "https://graph.facebook.com/v21.0";
const TOKEN = "test-token";

describe("PixelDiagnosticsChecker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("diagnoses an active pixel with all standard events", async () => {
    const pixelsResponse = {
      data: [
        {
          id: "pixel_1",
          name: "My Pixel",
          is_unavailable: false,
          last_fired_time: "2025-01-15T10:00:00Z",
        },
      ],
    };

    const statsResponse = {
      data: [
        { event: "PageView", count: 1000, last_fired_time: "2025-01-15T10:00:00Z" },
        { event: "Purchase", count: 50, last_fired_time: "2025-01-15T09:30:00Z" },
        { event: "AddToCart", count: 200, last_fired_time: "2025-01-15T09:45:00Z" },
        { event: "InitiateCheckout", count: 100, last_fired_time: "2025-01-15T09:00:00Z" },
        { event: "Lead", count: 30, last_fired_time: "2025-01-15T08:00:00Z" },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(pixelsResponse),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(statsResponse),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const checker = new PixelDiagnosticsChecker(BASE_URL, TOKEN);
    const results = await checker.diagnose("act_123");

    expect(results).toHaveLength(1);
    expect(results[0]!.pixelId).toBe("pixel_1");
    expect(results[0]!.pixelName).toBe("My Pixel");
    expect(results[0]!.isActive).toBe(true);
    expect(results[0]!.lastFiredTime).toBe("2025-01-15T10:00:00Z");
    expect(results[0]!.totalEventsLast24h).toBe(1380);
    expect(results[0]!.eventBreakdown).toHaveLength(5);
    expect(results[0]!.issues).toHaveLength(0);
  });

  it("detects inactive pixel", async () => {
    const pixelsResponse = {
      data: [
        {
          id: "pixel_2",
          name: "Broken Pixel",
          is_unavailable: true,
          last_fired_time: null,
        },
      ],
    };

    const statsResponse = { data: [] };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(pixelsResponse),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(statsResponse),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const checker = new PixelDiagnosticsChecker(BASE_URL, TOKEN);
    const results = await checker.diagnose("123");

    expect(results).toHaveLength(1);
    expect(results[0]!.isActive).toBe(false);
    expect(results[0]!.issues).toContain("Pixel is marked as unavailable");
    expect(results[0]!.issues).toContain("No events received in the last 24 hours");
    expect(results[0]!.issues).toContain("Pixel has never fired");
  });

  it("detects missing standard events", async () => {
    const pixelsResponse = {
      data: [
        {
          id: "pixel_3",
          name: "Partial Pixel",
          is_unavailable: false,
          last_fired_time: "2025-01-15T10:00:00Z",
        },
      ],
    };

    const statsResponse = {
      data: [
        { event: "PageView", count: 500, last_fired_time: "2025-01-15T10:00:00Z" },
        { event: "AddToCart", count: 50, last_fired_time: "2025-01-15T09:00:00Z" },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(pixelsResponse),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(statsResponse),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const checker = new PixelDiagnosticsChecker(BASE_URL, TOKEN);
    const results = await checker.diagnose("act_123");

    expect(results[0]!.issues).toContain("Missing standard event: Purchase");
    expect(results[0]!.issues).toContain("Missing standard event: InitiateCheckout");
    expect(results[0]!.issues).toContain("Missing standard event: Lead");
    expect(results[0]!.issues).not.toContain("Missing standard event: PageView");
    expect(results[0]!.issues).not.toContain("Missing standard event: AddToCart");
  });

  it("handles empty event data", async () => {
    const pixelsResponse = {
      data: [
        {
          id: "pixel_4",
          name: "Empty Pixel",
          is_unavailable: false,
          last_fired_time: "2025-01-10T10:00:00Z",
        },
      ],
    };

    // Stats endpoint fails for inactive pixels
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(pixelsResponse),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error("Stats not available"));
    vi.stubGlobal("fetch", fetchMock);

    const checker = new PixelDiagnosticsChecker(BASE_URL, TOKEN);
    const results = await checker.diagnose("act_123");

    expect(results).toHaveLength(1);
    expect(results[0]!.totalEventsLast24h).toBe(0);
    expect(results[0]!.eventBreakdown).toHaveLength(0);
    expect(results[0]!.issues).toContain("No events received in the last 24 hours");
  });
});
