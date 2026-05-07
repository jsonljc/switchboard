// packages/ad-optimizer/src/__tests__/signal-health-checker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignalHealthChecker } from "../signal-health-checker.js";

const BASE_URL = "https://graph.facebook.com/v21.0";
const PIXEL_ID = "px_123";

describe("SignalHealthChecker", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let checker: SignalHealthChecker;
  const NOW = new Date("2026-05-07T12:00:00Z").getTime();

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    checker = new SignalHealthChecker({ accessToken: "tok_test" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── getPixelHealth ──

  describe("getPixelHealth", () => {
    it("fetches pixel metadata and reports active when last_fired_time is recent", async () => {
      const lastFired = new Date(NOW - 30 * 60_000).toISOString();
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: PIXEL_ID,
            name: "Test Pixel",
            last_fired_time: lastFired,
            is_unavailable: false,
            automatic_matching_fields: ["em", "ph"],
          }),
      });

      const result = await checker.getPixelHealth(PIXEL_ID);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain(`${BASE_URL}/${PIXEL_ID}`);
      expect(url).toContain("fields=");
      expect(url).toContain("last_fired_time");
      expect(url).toContain("is_unavailable");
      expect(url).toContain("automatic_matching_fields");
      expect(result.pixelId).toBe(PIXEL_ID);
      expect(result.lastFiredAt).toBe(lastFired);
      expect(result.isUnavailable).toBe(false);
      expect(result.automaticMatchingFields).toEqual(["em", "ph"]);
      expect(result.isDead).toBe(false);
    });

    it("flags pixel as dead when is_unavailable is true", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: PIXEL_ID,
            name: "Dead Pixel",
            last_fired_time: null,
            is_unavailable: true,
            automatic_matching_fields: [],
          }),
      });

      const result = await checker.getPixelHealth(PIXEL_ID);

      expect(result.isDead).toBe(true);
      expect(result.isUnavailable).toBe(true);
    });

    it("flags pixel as dead when last_fired_time is older than 24h", async () => {
      const lastFired = new Date(NOW - 25 * 60 * 60_000).toISOString();
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: PIXEL_ID,
            name: "Stale Pixel",
            last_fired_time: lastFired,
            is_unavailable: false,
            automatic_matching_fields: [],
          }),
      });

      const result = await checker.getPixelHealth(PIXEL_ID);

      expect(result.isDead).toBe(true);
    });

    it("flags pixel as dead when last_fired_time is null", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: PIXEL_ID,
            name: "Never Fired",
            last_fired_time: null,
            is_unavailable: false,
            automatic_matching_fields: [],
          }),
      });

      const result = await checker.getPixelHealth(PIXEL_ID);

      expect(result.isDead).toBe(true);
    });
  });

  // ── getEventVolume ──

  describe("getEventVolume", () => {
    it("aggregates per-event totals with browser-vs-server split", async () => {
      // Two calls: one for combined stats, one for server-only stats.
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { event: "PageView", value: 1000 },
                { event: "Lead", value: 200 },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { event: "PageView", value: 600 },
                { event: "Lead", value: 180 },
              ],
            }),
        });

      const result = await checker.getEventVolume(PIXEL_ID);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const allUrl = fetchSpy.mock.calls[0]?.[0] as string;
      const serverUrl = fetchSpy.mock.calls[1]?.[0] as string;
      expect(allUrl).toContain(`/${PIXEL_ID}/stats`);
      expect(serverUrl).toContain(`/${PIXEL_ID}/stats`);
      expect(serverUrl).toContain("event_sources");
      expect(serverUrl).toContain("server");

      expect(result.events).toHaveLength(2);
      const pv = result.events.find((e) => e.eventName === "PageView");
      expect(pv).toEqual({
        eventName: "PageView",
        totalCount: 1000,
        serverCount: 600,
        browserCount: 400,
      });
      const lead = result.events.find((e) => e.eventName === "Lead");
      expect(lead).toEqual({
        eventName: "Lead",
        totalCount: 200,
        serverCount: 180,
        browserCount: 20,
      });
    });

    it("returns empty list when pixel has no recent events", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });

      const result = await checker.getEventVolume(PIXEL_ID);

      expect(result.events).toEqual([]);
    });
  });

  // ── getCAPIHealth ──

  describe("getCAPIHealth", () => {
    it("computes server-to-browser ratio, dedup rate, and freshness", async () => {
      // Stats: total=1000 server=900 browser=100 → server-to-browser ratio = 0.9
      // Dedup endpoint reports matched=750 of server=900 → 750/900 = 0.833
      // Last server event 30 min ago → freshness 1.8e6 ms (<1h)
      const lastFired = new Date(NOW - 30 * 60_000).toISOString();
      fetchSpy
        // /stats (combined)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [{ event: "Lead", value: 1000 }] }),
        })
        // /stats?event_sources=["server"]
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  event: "Lead",
                  value: 900,
                  matched_count: 750,
                  last_event_time: lastFired,
                },
              ],
            }),
        });

      const result = await checker.getCAPIHealth(PIXEL_ID);

      expect(result.serverToBrowserRatio).toBeCloseTo(0.9, 5);
      expect(result.dedupRate).toBeCloseTo(750 / 900, 5);
      expect(result.lastServerEventAt).toBe(lastFired);
      expect(result.freshnessMs).toBe(30 * 60_000);
      expect(result.isFresh).toBe(true);
    });

    it("flags freshness false when last server event is over 1h old", async () => {
      const lastFired = new Date(NOW - 2 * 60 * 60_000).toISOString();
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [{ event: "Lead", value: 100 }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  event: "Lead",
                  value: 50,
                  matched_count: 30,
                  last_event_time: lastFired,
                },
              ],
            }),
        });

      const result = await checker.getCAPIHealth(PIXEL_ID);

      expect(result.isFresh).toBe(false);
      expect(result.freshnessMs).toBeGreaterThan(60 * 60_000);
    });

    it("returns zero ratios when there is no traffic", async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) });

      const result = await checker.getCAPIHealth(PIXEL_ID);

      expect(result.serverToBrowserRatio).toBe(0);
      expect(result.dedupRate).toBe(0);
      expect(result.lastServerEventAt).toBeNull();
      expect(result.isFresh).toBe(false);
    });
  });

  // ── getDaChecks ──

  describe("getDaChecks", () => {
    it("returns per-event signal sufficiency", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                key: "lead_signal_sufficiency",
                event_name: "Lead",
                description: "Signal is sufficient",
                connection_method: "BROWSER_AND_SERVER",
                result: "PASS",
              },
              {
                key: "purchase_signal_sufficiency",
                event_name: "Purchase",
                description: "Insufficient events to optimize",
                connection_method: "BROWSER_ONLY",
                result: "FAIL",
              },
            ],
          }),
      });

      const result = await checker.getDaChecks(PIXEL_ID);

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain(`/${PIXEL_ID}/da_checks`);

      expect(result.checks).toHaveLength(2);
      const lead = result.checks.find((c) => c.eventName === "Lead");
      expect(lead?.passed).toBe(true);
      const purchase = result.checks.find((c) => c.eventName === "Purchase");
      expect(purchase?.passed).toBe(false);
      expect(result.hasFailure).toBe(true);
    });

    it("reports no failure when all checks pass", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                key: "k1",
                event_name: "Lead",
                description: "ok",
                connection_method: "BROWSER_AND_SERVER",
                result: "PASS",
              },
            ],
          }),
      });

      const result = await checker.getDaChecks(PIXEL_ID);

      expect(result.hasFailure).toBe(false);
    });
  });

  // ── Error handling ──

  describe("error handling", () => {
    it("throws a descriptive error when Graph API returns non-ok", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: { message: "Invalid pixel id", type: "OAuthException", code: 100 },
          }),
      });

      await expect(checker.getPixelHealth(PIXEL_ID)).rejects.toThrow(/Invalid pixel id/);
    });
  });
});
