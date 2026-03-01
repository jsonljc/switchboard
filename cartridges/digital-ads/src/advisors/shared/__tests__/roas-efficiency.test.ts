import { describe, it, expect } from "vitest";
import {
  roasEfficiencyAdvisor,
  createROASEfficiencyAdvisor,
} from "../roas-efficiency.js";
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

describe("roasEfficiencyAdvisor", () => {
  it("returns no findings when no ROAS data is available", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = roasEfficiencyAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("detects declining ROAS as warning", () => {
    const current = makeSnapshot({ topLevel: { roas: 3.0, spend: 1000 } });
    const previous = makeSnapshot({ topLevel: { roas: 4.0, spend: 1000 } });
    const findings = roasEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("ROAS declined");
    expect(findings[0].message).toContain("4.00x");
    expect(findings[0].message).toContain("3.00x");
  });

  it("detects severely declining ROAS as critical", () => {
    const current = makeSnapshot({ topLevel: { roas: 2.0, spend: 1000 } });
    const previous = makeSnapshot({ topLevel: { roas: 4.0, spend: 1000 } });
    const findings = roasEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("detects ROAS decline driven by AOV (CPA stable)", () => {
    const current = makeSnapshot({
      topLevel: { roas: 2.5, spend: 1000, cost_per_conversion: 20 },
    });
    const previous = makeSnapshot({
      topLevel: { roas: 4.0, spend: 1000, cost_per_conversion: 19 },
    });
    const findings = roasEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("average order value");
  });

  it("reports improving ROAS as healthy", () => {
    const current = makeSnapshot({ topLevel: { roas: 5.0, spend: 1000 } });
    const previous = makeSnapshot({ topLevel: { roas: 3.5, spend: 1000 } });
    const findings = roasEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("healthy");
  });

  it("does not trigger on small ROAS changes (<15%)", () => {
    const current = makeSnapshot({ topLevel: { roas: 3.6, spend: 1000 } });
    const previous = makeSnapshot({ topLevel: { roas: 4.0, spend: 1000 } });
    const findings = roasEfficiencyAdvisor([], [], current, previous);

    // -10% change, should not trigger warning
    expect(findings).toHaveLength(0);
  });

  it("flags when current ROAS is below target", () => {
    const advisor = createROASEfficiencyAdvisor({ targetROAS: 5.0 });
    const current = makeSnapshot({ topLevel: { roas: 3.0, spend: 1000 } });
    const previous = makeSnapshot({ topLevel: { roas: 3.0, spend: 1000 } });

    const findings = advisor([], [], current, previous);

    const targetFinding = findings.find((f) =>
      f.message.includes("below target")
    );
    expect(targetFinding).toBeDefined();
    expect(targetFinding!.severity).toBe("critical"); // 40% shortfall
  });

  it("does not flag target when ROAS meets target", () => {
    const advisor = createROASEfficiencyAdvisor({ targetROAS: 3.0 });
    const current = makeSnapshot({ topLevel: { roas: 4.0, spend: 1000 } });
    const previous = makeSnapshot({ topLevel: { roas: 4.0, spend: 1000 } });

    const findings = advisor([], [], current, previous);

    const targetFinding = findings.find((f) =>
      f.message.includes("below target")
    );
    expect(targetFinding).toBeUndefined();
  });

  it("reads ROAS from Meta-style roas_ prefixed keys", () => {
    const current = makeSnapshot({
      topLevel: {
        "roas_offsite_conversion.fb_pixel_purchase": 2.5,
        spend: 1000,
      },
    });
    const previous = makeSnapshot({
      topLevel: {
        "roas_offsite_conversion.fb_pixel_purchase": 4.0,
        spend: 1000,
      },
    });
    const findings = roasEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("ROAS declined");
  });
});
