import { describe, it, expect } from "vitest";
import { reachSaturationAdvisor } from "../reach-saturation.js";
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

describe("reachSaturationAdvisor", () => {
  it("returns no findings when no reach data", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = reachSaturationAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("detects reach saturation when spend up but reach flat", () => {
    const current = makeSnapshot({
      spend: 1500,
      topLevel: { reach: 50000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      spend: 1000,
      topLevel: { reach: 49000, impressions: 70000 },
    });
    const findings = reachSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Reach saturation");
  });

  it("flags critical when spend up but reach declining", () => {
    const current = makeSnapshot({
      spend: 2000,
      topLevel: { reach: 40000, impressions: 120000 },
    });
    const previous = makeSnapshot({
      spend: 1000,
      topLevel: { reach: 50000, impressions: 70000 },
    });
    const findings = reachSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("reports healthy when reach grows proportionally to spend", () => {
    const current = makeSnapshot({
      spend: 1500,
      topLevel: { reach: 75000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      spend: 1000,
      topLevel: { reach: 50000, impressions: 70000 },
    });
    const findings = reachSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("healthy");
  });

  it("does not trigger when spend did not increase significantly", () => {
    const current = makeSnapshot({
      spend: 1050,
      topLevel: { reach: 50000, impressions: 100000 },
    });
    const previous = makeSnapshot({
      spend: 1000,
      topLevel: { reach: 50000, impressions: 95000 },
    });
    const findings = reachSaturationAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });
});
