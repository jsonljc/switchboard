import { describe, it, expect } from "vitest";
import { audienceSaturationAdvisor } from "../audience-saturation.js";
import type { MetricSnapshot } from "../../../core/types.js";

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

describe("audienceSaturationAdvisor", () => {
  it("returns no findings when frequency data is unavailable", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = audienceSaturationAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags critical audience exhaustion at frequency > 6", () => {
    const current = makeSnapshot({
      topLevel: { frequency: 7.2, ctr: 1.5 },
    });
    const previous = makeSnapshot({
      topLevel: { frequency: 5.0, ctr: 2.0 },
    });
    const findings = audienceSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("7.2");
    expect(findings[0].message).toContain("Audience exhaustion");
  });

  it("flags warning when frequency 3-6 with declining CTR", () => {
    const current = makeSnapshot({
      topLevel: { frequency: 4.5, ctr: 1.5 },
    });
    const previous = makeSnapshot({
      topLevel: { frequency: 3.0, ctr: 2.0 },
    });
    const findings = audienceSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("root cause");
  });

  it("flags info when frequency rising rapidly but CTR stable", () => {
    const current = makeSnapshot({
      topLevel: { frequency: 4.0, ctr: 2.0 },
    });
    const previous = makeSnapshot({
      topLevel: { frequency: 3.2, ctr: 2.0 },
    });
    const findings = audienceSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("Frequency rising");
  });

  it("reports healthy reach at low frequency with stable CTR", () => {
    const current = makeSnapshot({
      topLevel: { frequency: 1.5, ctr: 2.0 },
    });
    const previous = makeSnapshot({
      topLevel: { frequency: 1.3, ctr: 2.1 },
    });
    const findings = audienceSaturationAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("healthy");
  });

  it("does not stack findings for frequency > 6 (returns early)", () => {
    const current = makeSnapshot({
      topLevel: { frequency: 8.0, ctr: 0.5 },
    });
    const previous = makeSnapshot({
      topLevel: { frequency: 5.0, ctr: 2.0 },
    });
    const findings = audienceSaturationAdvisor([], [], current, previous);

    // Should only get the critical finding, not the warning too
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("does not flag frequency 3 with stable CTR as warning", () => {
    const current = makeSnapshot({
      topLevel: { frequency: 3.1, ctr: 2.0 },
    });
    const previous = makeSnapshot({
      topLevel: { frequency: 2.8, ctr: 2.1 },
    });
    const findings = audienceSaturationAdvisor([], [], current, previous);

    // CTR change is only ~5%, not >10%, so no warning
    // But frequency is >3 and rising >15% — check info
    // frequency change = (3.1-2.8)/2.8*100 = 10.7% — under 15%, so no info either
    // Should only get healthy (frequency > 0 and <= 2 condition fails since 3.1 > 2)
    expect(findings.every((f) => f.severity !== "warning")).toBe(true);
  });
});
