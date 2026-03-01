import { describe, it, expect } from "vitest";
import { deviceBreakdownAdvisor } from "../device-breakdown.js";
import type {
  MetricSnapshot,
  DiagnosticContext,
  DeviceBreakdown,
} from "../../../core/types.js";

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

function makeDevice(overrides: Partial<DeviceBreakdown> = {}): DeviceBreakdown {
  return {
    device: "mobile",
    spend: 500,
    impressions: 50000,
    clicks: 500,
    conversions: 25,
    cpa: 20,
    cpm: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deviceBreakdownAdvisor", () => {
  it("returns no findings when no device data is available", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = deviceBreakdownAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags devices with CPA > 2x average", () => {
    const devices: DeviceBreakdown[] = [
      makeDevice({ device: "mobile", spend: 500, conversions: 50 }),   // CPA = 10
      makeDevice({ device: "desktop", spend: 300, conversions: 30 }),  // CPA = 10
      makeDevice({ device: "tablet", spend: 200, conversions: 2 }),    // CPA = 100 (>2x avg)
    ];
    const context: DiagnosticContext = { deviceBreakdowns: devices };
    const findings = deviceBreakdownAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const disparity = findings.filter((f) => f.message.includes("CPA disparity"));
    expect(disparity).toHaveLength(1);
    expect(disparity[0].message).toContain("Tablet");
  });

  it("flags zero-conversion devices with significant spend", () => {
    const devices: DeviceBreakdown[] = [
      makeDevice({ device: "mobile", spend: 500, conversions: 50 }),
      makeDevice({ device: "tablet", spend: 200, conversions: 0 }),    // 0 conv, 29% spend
    ];
    const context: DiagnosticContext = { deviceBreakdowns: devices };
    const findings = deviceBreakdownAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const zeroConv = findings.filter((f) => f.message.includes("zero conversions"));
    expect(zeroConv).toHaveLength(1);
    expect(zeroConv[0].message).toContain("Tablet");
  });

  it("flags mobile vs desktop CPA gap when mobile is expensive", () => {
    const devices: DeviceBreakdown[] = [
      makeDevice({ device: "mobile", spend: 500, conversions: 10 }),   // CPA = 50
      makeDevice({ device: "desktop", spend: 500, conversions: 50 }), // CPA = 10
    ];
    const context: DiagnosticContext = { deviceBreakdowns: devices };
    const findings = deviceBreakdownAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const gapFindings = findings.filter((f) => f.message.includes("Mobile CPA"));
    expect(gapFindings.length).toBeGreaterThanOrEqual(1);
    expect(gapFindings[0].message).toContain("5.0x");
  });

  it("flags desktop vs mobile CPA gap when desktop is expensive", () => {
    const devices: DeviceBreakdown[] = [
      makeDevice({ device: "mobile", spend: 500, conversions: 50 }),   // CPA = 10
      makeDevice({ device: "desktop", spend: 500, conversions: 10 }), // CPA = 50
    ];
    const context: DiagnosticContext = { deviceBreakdowns: devices };
    const findings = deviceBreakdownAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const gapFindings = findings.filter((f) => f.message.includes("Desktop CPA"));
    expect(gapFindings.length).toBeGreaterThanOrEqual(1);
    expect(gapFindings[0].message).toContain("5.0x");
  });

  it("does not flag when mobile and desktop CPA are similar", () => {
    const devices: DeviceBreakdown[] = [
      makeDevice({ device: "mobile", spend: 500, conversions: 40 }),   // CPA = 12.5
      makeDevice({ device: "desktop", spend: 500, conversions: 50 }), // CPA = 10
    ];
    const context: DiagnosticContext = { deviceBreakdowns: devices };
    const findings = deviceBreakdownAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const gapFindings = findings.filter(
      (f) => f.message.includes("Mobile CPA") || f.message.includes("Desktop CPA")
    );
    expect(gapFindings).toHaveLength(0);
  });

  it("does not flag small device segments below spend threshold", () => {
    const devices: DeviceBreakdown[] = [
      makeDevice({ device: "mobile", spend: 900, conversions: 45 }),
      makeDevice({ device: "tablet", spend: 50, conversions: 1 }),   // <10% spend share
      makeDevice({ device: "desktop", spend: 50, conversions: 5 }), // <10% spend share
    ];
    const context: DiagnosticContext = { deviceBreakdowns: devices };
    const findings = deviceBreakdownAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const disparity = findings.filter((f) => f.message.includes("CPA disparity"));
    expect(disparity).toHaveLength(0);
  });
});
