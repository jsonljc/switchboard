// packages/ad-optimizer/src/__tests__/signal-health-checker-report.test.ts
//
// Covers the getSignalHealthReport() composition + score logic. Per-method
// fetch behavior is exercised in signal-health-checker.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignalHealthChecker } from "../signal-health-checker.js";

const PIXEL_ID = "px_123";
const NOW = new Date("2026-05-07T12:00:00Z").getTime();

interface ServerEventRow {
  event: string;
  value: number;
  matched_count?: number;
  last_event_time?: string;
}

interface DaCheckRow {
  event_name: string;
  result: "PASS" | "FAIL";
}

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

function pixelResponse(opts: {
  lastFired: string | null;
  isUnavailable?: boolean;
  fields?: string[];
}) {
  return jsonResponse({
    id: PIXEL_ID,
    name: "P",
    last_fired_time: opts.lastFired,
    is_unavailable: opts.isUnavailable ?? false,
    automatic_matching_fields: opts.fields ?? ["em"],
  });
}

function statsResponse(rows: Array<{ event: string; value: number }>) {
  return jsonResponse({ data: rows });
}

function serverStatsResponse(rows: ServerEventRow[]) {
  return jsonResponse({ data: rows });
}

function daChecksResponse(rows: DaCheckRow[]) {
  return jsonResponse({
    data: rows.map((r) => ({
      key: `k_${r.event_name}`,
      event_name: r.event_name,
      description: r.result === "PASS" ? "ok" : "Insufficient",
      connection_method: r.result === "PASS" ? "BROWSER_AND_SERVER" : "BROWSER_ONLY",
      result: r.result,
    })),
  });
}

function queueReportFetches(
  fetchSpy: ReturnType<typeof vi.fn>,
  scenario: {
    pixel: ReturnType<typeof pixelResponse>;
    combined: ReturnType<typeof statsResponse>;
    serverEvents: ReturnType<typeof serverStatsResponse>;
    daChecks: ReturnType<typeof daChecksResponse>;
  },
) {
  // Order matches the order of get*() calls inside getSignalHealthReport:
  // pixelHealth → eventVolume(combined,server) → capiHealth(combined,server) → daChecks
  fetchSpy
    .mockResolvedValueOnce(scenario.pixel)
    .mockResolvedValueOnce(scenario.combined)
    .mockResolvedValueOnce(scenario.serverEvents)
    .mockResolvedValueOnce(scenario.combined)
    .mockResolvedValueOnce(scenario.serverEvents)
    .mockResolvedValueOnce(scenario.daChecks);
}

describe("SignalHealthChecker.getSignalHealthReport", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let checker: SignalHealthChecker;
  const lastFiredFresh = new Date(NOW - 10 * 60_000).toISOString();

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

  it("returns green when all signals healthy", async () => {
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: lastFiredFresh }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 950, matched_count: 800, last_event_time: lastFiredFresh },
      ]),
      daChecks: daChecksResponse([{ event_name: "Lead", result: "PASS" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.pixelId).toBe(PIXEL_ID);
    expect(report.score).toBe("green");
    expect(report.breaches).toEqual([]);
    // EMQ proxy = 0.95 * (800/950)
    expect(report.emqProxy).toBeCloseTo(0.95 * (800 / 950), 5);
  });

  it("returns red when pixel is dead", async () => {
    fetchSpy.mockResolvedValueOnce(
      pixelResponse({ lastFired: null, isUnavailable: true, fields: [] }),
    );
    fetchSpy.mockResolvedValue(jsonResponse({ data: [] }));

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("red");
    const pixelDead = report.breaches.find((b) => b.signal === "pixel_dead");
    expect(pixelDead).toBeDefined();
    expect(pixelDead?.severity).toBe("critical");
  });

  it("returns red when server-to-browser ratio is below 50%", async () => {
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: lastFiredFresh }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      // 300/1000 = 0.3 ratio (critical)
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 300, matched_count: 250, last_event_time: lastFiredFresh },
      ]),
      daChecks: daChecksResponse([{ event_name: "Lead", result: "PASS" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("red");
    const breach = report.breaches.find((b) => b.signal === "server_to_browser_low");
    expect(breach).toBeDefined();
    expect(breach?.severity).toBe("critical");
  });

  it("returns yellow when ratio is between 50% and 90%", async () => {
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: lastFiredFresh }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      // 700/1000 = 0.7 ratio (yellow)
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 700, matched_count: 600, last_event_time: lastFiredFresh },
      ]),
      daChecks: daChecksResponse([{ event_name: "Lead", result: "PASS" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("yellow");
    const breach = report.breaches.find((b) => b.signal === "server_to_browser_low");
    expect(breach).toBeDefined();
    expect(breach?.severity).toBe("warning");
  });

  it("returns yellow with dedup_low breach when dedup rate <50%", async () => {
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: lastFiredFresh }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      // 200/950 ≈ 0.21 dedup rate
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 950, matched_count: 200, last_event_time: lastFiredFresh },
      ]),
      daChecks: daChecksResponse([{ event_name: "Lead", result: "PASS" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("yellow");
    const breach = report.breaches.find((b) => b.signal === "dedup_low");
    expect(breach).toBeDefined();
    expect(breach?.severity).toBe("warning");
  });

  it("returns yellow with freshness_stale breach when last event >1h old", async () => {
    const stalePixelFire = new Date(NOW - 30 * 60_000).toISOString();
    const staleServerEvent = new Date(NOW - 2 * 60 * 60_000).toISOString();
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: stalePixelFire }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 950, matched_count: 800, last_event_time: staleServerEvent },
      ]),
      daChecks: daChecksResponse([{ event_name: "Lead", result: "PASS" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("yellow");
    const breach = report.breaches.find((b) => b.signal === "freshness_stale");
    expect(breach).toBeDefined();
  });

  it("does not emit dedup_low breach when matched_count is unavailable", async () => {
    // Server traffic exists but matched_count is absent on every row —
    // Meta's response did not surface dedup data, so dedupRate is unknown.
    // We must NOT emit dedup_low (false positive) just because the field
    // defaulted to 0/null.
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: lastFiredFresh }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 950, last_event_time: lastFiredFresh },
      ]),
      daChecks: daChecksResponse([{ event_name: "Lead", result: "PASS" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("green");
    expect(report.breaches.find((b) => b.signal === "dedup_low")).toBeUndefined();
    expect(report.capiHealth.dedupRate).toBeNull();
    // EMQ proxy collapses to 0 when dedup is unknown — surfaces as a clear
    // signal in downstream displays rather than a misleading number.
    expect(report.emqProxy).toBe(0);
  });

  it("returns yellow with da_check_failed breach when DA check fails", async () => {
    queueReportFetches(fetchSpy, {
      pixel: pixelResponse({ lastFired: lastFiredFresh }),
      combined: statsResponse([{ event: "Lead", value: 1000 }]),
      serverEvents: serverStatsResponse([
        { event: "Lead", value: 950, matched_count: 800, last_event_time: lastFiredFresh },
      ]),
      daChecks: daChecksResponse([{ event_name: "Purchase", result: "FAIL" }]),
    });

    const report = await checker.getSignalHealthReport(PIXEL_ID);

    expect(report.score).toBe("yellow");
    const breach = report.breaches.find((b) => b.signal === "da_check_failed");
    expect(breach).toBeDefined();
  });
});
