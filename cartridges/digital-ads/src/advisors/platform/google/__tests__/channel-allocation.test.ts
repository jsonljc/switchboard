import { describe, it, expect } from "vitest";
import { googleChannelAdvisor } from "../channel-allocation.js";
import type { MetricSnapshot } from "../../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "123-456-7890",
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

describe("googleChannelAdvisor", () => {
  it("returns no findings when no channel data is available", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings with only 1 channel", () => {
    const current = makeSnapshot({
      topLevel: {
        channel_spend_search: 1000,
        channel_conversions_search: 50,
      },
    });
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags channels with CPA > 2x best channel", () => {
    const current = makeSnapshot({
      topLevel: {
        channel_spend_search: 500,
        channel_conversions_search: 50,    // CPA = $10
        channel_spend_display: 400,
        channel_conversions_display: 5,     // CPA = $80 (8x)
        channel_spend_shopping: 100,
        channel_conversions_shopping: 8,    // CPA = $12.50
      },
    });
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);

    const disparity = findings.filter((f) =>
      f.message.includes("CPA disparity")
    );
    expect(disparity).toHaveLength(1);
    expect(disparity[0].message).toContain("Display");
    expect(disparity[0].message).toContain("Search");
  });

  it("flags zero-conversion channels with significant spend", () => {
    const current = makeSnapshot({
      topLevel: {
        channel_spend_search: 500,
        channel_conversions_search: 50,
        channel_spend_video: 200,
        channel_conversions_video: 0,       // Zero conversions, 29% spend
        channel_spend_shopping: 100,
        channel_conversions_shopping: 10,
      },
    });
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);

    const zeroConv = findings.filter((f) =>
      f.message.includes("Zero-conversion")
    );
    expect(zeroConv).toHaveLength(1);
    expect(zeroConv[0].message).toContain("Video");
  });

  it("reports healthy when all channels are within 2x CPA", () => {
    const current = makeSnapshot({
      topLevel: {
        channel_spend_search: 500,
        channel_conversions_search: 50,    // CPA = $10
        channel_spend_shopping: 300,
        channel_conversions_shopping: 25,  // CPA = $12
        channel_spend_display: 200,
        channel_conversions_display: 12,   // CPA = $16.67
      },
    });
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);

    expect(findings.some((f) => f.severity === "healthy")).toBe(true);
  });

  it("escalates to critical when >30% spend is on inefficient channels", () => {
    const current = makeSnapshot({
      topLevel: {
        channel_spend_search: 200,
        channel_conversions_search: 40,    // CPA = $5
        channel_spend_display: 500,
        channel_conversions_display: 5,     // CPA = $100 (20x)
        channel_spend_video: 300,
        channel_conversions_video: 3,       // CPA = $100 (20x)
      },
    });
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);

    const disparity = findings.filter(
      (f) => f.message.includes("CPA disparity")
    );
    expect(disparity).toHaveLength(1);
    expect(disparity[0].severity).toBe("critical");
  });

  it("does not flag channels with < 2 converting channels", () => {
    const current = makeSnapshot({
      topLevel: {
        channel_spend_search: 500,
        channel_conversions_search: 50,
        channel_spend_display: 300,
        channel_conversions_display: 0,
      },
    });
    const previous = makeSnapshot();
    const findings = googleChannelAdvisor([], [], current, previous);

    // Only 1 converting channel — should not flag CPA disparity
    const disparity = findings.filter(
      (f) => f.message.includes("CPA disparity")
    );
    expect(disparity).toHaveLength(0);
  });
});
