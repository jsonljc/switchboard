import { describe, it, expect } from "vitest";
import { videoCompletionAdvisor } from "../video-completion.js";
import type { MetricSnapshot } from "../../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("videoCompletionAdvisor", () => {
  it("returns no findings when no video data", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = videoCompletionAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("detects declining video completion rate as warning", () => {
    const current = makeSnapshot({
      topLevel: { video_thruplay_actions: 15000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      topLevel: { video_thruplay_actions: 20000, impressions: 100000 },
    });
    const findings = videoCompletionAdvisor([], [], current, previous);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const vcrFinding = findings.find((f) =>
      f.message.includes("Video completion rate declined")
    );
    expect(vcrFinding).toBeDefined();
    expect(vcrFinding!.severity).toBe("warning");
  });

  it("flags critical when VCR drops > 30%", () => {
    const current = makeSnapshot({
      topLevel: { video_thruplay_actions: 10000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      topLevel: { video_thruplay_actions: 25000, impressions: 100000 },
    });
    const findings = videoCompletionAdvisor([], [], current, previous);

    const vcrFinding = findings.find((f) =>
      f.message.includes("Video completion rate declined")
    );
    expect(vcrFinding).toBeDefined();
    expect(vcrFinding!.severity).toBe("critical");
  });

  it("reports improving VCR as healthy", () => {
    const current = makeSnapshot({
      topLevel: { video_thruplay_actions: 30000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      topLevel: { video_thruplay_actions: 20000, impressions: 100000 },
    });
    const findings = videoCompletionAdvisor([], [], current, previous);

    const healthyFinding = findings.find((f) => f.severity === "healthy");
    expect(healthyFinding).toBeDefined();
  });

  it("flags low absolute VCR", () => {
    const current = makeSnapshot({
      topLevel: { video_views: 5000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      topLevel: { video_views: 5500, impressions: 100000 },
    });
    const findings = videoCompletionAdvisor([], [], current, previous);

    const lowVCR = findings.find((f) => f.message.includes("low at"));
    expect(lowVCR).toBeDefined();
    expect(lowVCR!.severity).toBe("info");
  });

  it("works with TikTok video_views_p50 metric", () => {
    const current = makeSnapshot({
      topLevel: { video_views_p50: 12000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      topLevel: { video_views_p50: 20000, impressions: 100000 },
    });
    const findings = videoCompletionAdvisor([], [], current, previous);

    expect(findings.length).toBeGreaterThanOrEqual(1);
  });
});
