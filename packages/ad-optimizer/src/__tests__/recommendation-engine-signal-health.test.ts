// packages/ad-optimizer/src/__tests__/recommendation-engine-signal-health.test.ts
import { describe, it, expect } from "vitest";
import { generateSignalHealthRecommendations } from "../recommendation-engine.js";
import type {
  SignalHealthReport,
  Breach,
  PixelHealth,
  EventVolume,
  CAPIHealth,
  DaChecks,
} from "../signal-health-checker.js";

function makeSignalHealthReport(overrides: {
  score: SignalHealthReport["score"];
  breaches: Breach[];
}): SignalHealthReport {
  const pixelHealth: PixelHealth = {
    pixelId: "px_1",
    name: "Test Pixel",
    lastFiredAt: new Date().toISOString(),
    isUnavailable: false,
    automaticMatchingFields: ["em"],
    isDead: false,
  };
  const eventVolume: EventVolume = { events: [] };
  const capiHealth: CAPIHealth = {
    serverToBrowserRatio: 0.95,
    dedupRate: 0.85,
    lastServerEventAt: new Date().toISOString(),
    freshnessMs: 60_000,
    isFresh: true,
  };
  const daChecks: DaChecks = { checks: [], hasFailure: false };
  return {
    pixelId: "px_1",
    score: overrides.score,
    pixelHealth,
    eventVolume,
    capiHealth,
    daChecks,
    emqProxy: 0.85 * 0.95,
    breaches: overrides.breaches,
  };
}

describe("generateSignalHealthRecommendations", () => {
  const ctx = { pixelId: "px_1", accountId: "act_123" };

  it("returns empty array when there are no breaches", () => {
    const report = makeSignalHealthReport({ score: "green", breaches: [] });
    const result = generateSignalHealthRecommendations(report, ctx);
    expect(result).toEqual([]);
  });

  it("generates fix_signal_health with website-installation steps for pixel_dead breach", () => {
    const report = makeSignalHealthReport({
      score: "red",
      breaches: [
        { signal: "pixel_dead", severity: "critical", message: "Pixel has not fired in 24h." },
      ],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toHaveLength(1);
    const rec = result[0]!;
    expect(rec.action).toBe("fix_signal_health");
    expect(rec.urgency).toBe("immediate");
    const stepsText = rec.steps.join(" ").toLowerCase();
    expect(stepsText).toContain("website installation");
    expect(rec.params?.breach).toBe("pixel_dead");
  });

  it("generates fix_signal_health with token + pixel ID steps for critical server_to_browser_low", () => {
    const report = makeSignalHealthReport({
      score: "red",
      breaches: [
        {
          signal: "server_to_browser_low",
          severity: "critical",
          message: "Server-to-browser ratio is critically low (<50%).",
        },
      ],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toHaveLength(1);
    const rec = result[0]!;
    expect(rec.action).toBe("fix_signal_health");
    expect(rec.urgency).toBe("immediate");
    const stepsText = rec.steps.join(" ");
    expect(stepsText).toMatch(/CAPI access token/i);
    expect(stepsText).toMatch(/pixel ID/i);
    expect(stepsText).toMatch(/test event/i);
  });

  it("generates fix_signal_health with this_week urgency for warning server_to_browser_low", () => {
    const report = makeSignalHealthReport({
      score: "yellow",
      breaches: [
        {
          signal: "server_to_browser_low",
          severity: "warning",
          message: "Ratio 70% (target >90%).",
        },
      ],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toHaveLength(1);
    expect(result[0]!.urgency).toBe("this_week");
  });

  it("generates fix_signal_health with event_id match steps for dedup_low breach", () => {
    const report = makeSignalHealthReport({
      score: "yellow",
      breaches: [
        { signal: "dedup_low", severity: "warning", message: "Dedup rate 30% (target >50%)." },
      ],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toHaveLength(1);
    const stepsText = result[0]!.steps.join(" ");
    expect(stepsText).toMatch(/event_id/);
    expect(stepsText).toMatch(/browser pixel/i);
    expect(stepsText).toMatch(/CAPI/);
  });

  it("generates fix_signal_health with dispatch latency steps for freshness_stale breach", () => {
    const report = makeSignalHealthReport({
      score: "yellow",
      breaches: [
        {
          signal: "freshness_stale",
          severity: "warning",
          message: "Last event >1h old.",
        },
      ],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toHaveLength(1);
    const stepsText = result[0]!.steps.join(" ").toLowerCase();
    expect(stepsText).toContain("dispatch latency");
    expect(stepsText).toMatch(/webhook|queue/);
  });

  it("generates one fix_signal_health rec per breach when multiple breaches present", () => {
    const report = makeSignalHealthReport({
      score: "yellow",
      breaches: [
        { signal: "server_to_browser_low", severity: "warning", message: "..." },
        { signal: "dedup_low", severity: "warning", message: "..." },
        { signal: "freshness_stale", severity: "warning", message: "..." },
      ],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.params?.breach).sort()).toEqual([
      "dedup_low",
      "freshness_stale",
      "server_to_browser_low",
    ]);
  });

  it("ignores da_check_failed breaches (not in fix_signal_health scope)", () => {
    const report = makeSignalHealthReport({
      score: "yellow",
      breaches: [{ signal: "da_check_failed", severity: "warning", message: "Insufficient." }],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result).toEqual([]);
  });

  it("uses the pixel/account context as campaign identifier so recs are attributable", () => {
    const report = makeSignalHealthReport({
      score: "red",
      breaches: [{ signal: "pixel_dead", severity: "critical", message: "Dead." }],
    });

    const result = generateSignalHealthRecommendations(report, ctx);

    expect(result[0]!.campaignId).toContain("px_1");
    expect(result[0]!.params?.pixelId).toBe("px_1");
  });
});
