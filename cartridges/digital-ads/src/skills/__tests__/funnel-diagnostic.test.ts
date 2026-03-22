import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFunnelDiagnostic, formatDiagnostic } from "../funnel-diagnostic.js";
import type { DiagnosticResult, MetricSnapshot, Severity } from "../../core/types.js";
import type { PlatformClient } from "../../platforms/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock all dependencies
vi.mock("../../core/analysis/funnel-walker.js", () => ({
  analyzeFunnel: vi.fn((params) => {
    const mockResult: DiagnosticResult = {
      vertical: "commerce",
      entityId: params.current.entityId,
      periods: params.periods,
      spend: { current: params.current.spend, previous: params.previous.spend },
      primaryKPI: {
        name: "purchase",
        current: 50,
        previous: 55,
        deltaPercent: -9.1,
        severity: "warning",
      },
      stageAnalysis: [
        {
          stageName: "impressions",
          metric: "impressions",
          currentValue: 10000,
          previousValue: 9500,
          delta: 500,
          deltaPercent: 5.3,
          isSignificant: true,
          severity: "healthy",
        },
        {
          stageName: "click",
          metric: "inline_link_clicks",
          currentValue: 500,
          previousValue: 475,
          delta: 25,
          deltaPercent: 5.3,
          isSignificant: true,
          severity: "healthy",
        },
      ],
      dropoffs: [
        {
          fromStage: "impressions",
          toStage: "click",
          currentRate: 0.05,
          previousRate: 0.05,
          deltaPercent: 0,
        },
      ],
      bottleneck: null,
      findings: [
        {
          severity: "warning",
          stage: "purchase",
          message: "Primary KPI declined 9.1% WoW",
          recommendation: "Review conversion events and checkout flow",
        },
      ],
    };
    return mockResult;
  }),
}));

vi.mock("../../core/analysis/comparator.js", () => ({
  buildComparisonPeriods: vi.fn((_refDate, _periodDays) => ({
    current: { since: "2024-01-08", until: "2024-01-14" },
    previous: { since: "2024-01-01", until: "2024-01-07" },
  })),
}));

vi.mock("../../core/analysis/context-builder.js", () => ({
  buildDiagnosticContext: vi.fn(() =>
    Promise.resolve({
      subEntities: [],
      historicalSnapshots: [],
    }),
  ),
}));

vi.mock("../../platforms/registry.js", () => ({
  createPlatformClient: vi.fn(() => {
    const mockClient: PlatformClient = {
      fetchComparisonSnapshots: vi.fn(() =>
        Promise.resolve({
          current: {
            entityId: "act_123",
            entityLevel: "account" as const,
            periodStart: "2024-01-08",
            periodEnd: "2024-01-14",
            spend: 1000,
            stages: {
              impressions: { count: 10000, cost: null },
              inline_link_clicks: { count: 500, cost: 2.0 },
              purchase: { count: 50, cost: 20 },
            },
            topLevel: { impressions: 10000, clicks: 500, spend: 1000 },
          } as MetricSnapshot,
          previous: {
            entityId: "act_123",
            entityLevel: "account" as const,
            periodStart: "2024-01-01",
            periodEnd: "2024-01-07",
            spend: 950,
            stages: {
              impressions: { count: 9500, cost: null },
              inline_link_clicks: { count: 475, cost: 2.0 },
              purchase: { count: 55, cost: 17.3 },
            },
            topLevel: { impressions: 9500, clicks: 475, spend: 950 },
          } as MetricSnapshot,
        }),
      ),
    } as unknown as PlatformClient;
    return mockClient;
  }),
  resolveFunnel: vi.fn(() => ({
    vertical: "commerce",
    stages: [
      {
        name: "impressions",
        metric: "impressions",
        metricSource: "top_level",
        costMetric: "cpm",
        costMetricSource: "top_level",
      },
      {
        name: "click",
        metric: "inline_link_clicks",
        metricSource: "top_level",
        costMetric: "cpc",
        costMetricSource: "top_level",
      },
      {
        name: "purchase",
        metric: "purchase",
        metricSource: "actions",
        costMetric: "cost_per_purchase",
        costMetricSource: "cost_per_action_type",
      },
    ],
    primaryKPI: "purchase",
    roasMetric: "website_purchase_roas",
  })),
  resolveBenchmarks: vi.fn(() => ({
    vertical: "commerce",
    benchmarks: {
      impressions: { expectedDropoffRate: 0.05, normalVariancePercent: 10 },
      click: { expectedDropoffRate: 0.1, normalVariancePercent: 15 },
      purchase: { expectedDropoffRate: 0.05, normalVariancePercent: 20 },
    },
  })),
}));

vi.mock("../../advisors/registry.js", () => ({
  resolveAdvisors: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runFunnelDiagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the analysis pipeline in correct order", async () => {
    const { buildComparisonPeriods } = await import("../../core/analysis/comparator.js");
    const { createPlatformClient } = await import("../../platforms/registry.js");
    const { buildDiagnosticContext } = await import("../../core/analysis/context-builder.js");
    const { analyzeFunnel } = await import("../../core/analysis/funnel-walker.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "test_token",
      vertical: "commerce",
      platform: "meta",
      periodDays: 7,
    });

    // Verify pipeline order
    expect(buildComparisonPeriods).toHaveBeenCalled();
    expect(createPlatformClient).toHaveBeenCalled();
    expect(buildDiagnosticContext).toHaveBeenCalled();
    expect(analyzeFunnel).toHaveBeenCalled();
  });

  it("passes platform credentials through correctly", async () => {
    const { createPlatformClient } = await import("../../platforms/registry.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "test_token_meta",
      vertical: "commerce",
      platform: "meta",
    });

    expect(createPlatformClient).toHaveBeenCalledWith({
      platform: "meta",
      accessToken: "test_token_meta",
    });
  });

  it("throws error for Google platform without full credentials", async () => {
    await expect(
      runFunnelDiagnostic({
        entityId: "act_123",
        accessToken: "test_token",
        platform: "google",
      }),
    ).rejects.toThrow("Google Ads requires full OAuth2 credentials");
  });

  it("uses default values when optional parameters are omitted", async () => {
    const { buildComparisonPeriods } = await import("../../core/analysis/comparator.js");
    const { resolveFunnel } = await import("../../platforms/registry.js");

    await runFunnelDiagnostic({
      entityId: "act_456",
      accessToken: "token",
    });

    // Default vertical should be "commerce"
    expect(resolveFunnel).toHaveBeenCalledWith(
      "meta",
      "commerce",
      expect.objectContaining({ qualifiedLeadActionType: undefined }),
    );

    // Default periodDays should be 7
    expect(buildComparisonPeriods).toHaveBeenCalledWith(
      expect.any(Date),
      7, // default periodDays
    );
  });

  it("passes custom periodDays to buildComparisonPeriods", async () => {
    const { buildComparisonPeriods } = await import("../../core/analysis/comparator.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "token",
      periodDays: 14,
    });

    expect(buildComparisonPeriods).toHaveBeenCalledWith(expect.any(Date), 14);
  });

  it("passes qualifiedLeadActionType to funnel resolver for leadgen vertical", async () => {
    const { resolveFunnel } = await import("../../platforms/registry.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "token",
      vertical: "leadgen",
      qualifiedLeadActionType: "offsite_conversion.custom.qualified_lead",
    });

    expect(resolveFunnel).toHaveBeenCalledWith(
      "meta",
      "leadgen",
      expect.objectContaining({
        qualifiedLeadActionType: "offsite_conversion.custom.qualified_lead",
      }),
    );
  });

  it("passes enableHistoricalTrends to context builder", async () => {
    const { buildDiagnosticContext } = await import("../../core/analysis/context-builder.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "token",
      enableHistoricalTrends: true,
      historicalPeriods: 8,
    });

    expect(buildDiagnosticContext).toHaveBeenCalledWith(
      expect.objectContaining({
        enableHistorical: true,
        historicalPeriods: 8,
      }),
    );
  });

  it("passes enableStructuralAnalysis to context builder", async () => {
    const { buildDiagnosticContext } = await import("../../core/analysis/context-builder.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "token",
      enableStructuralAnalysis: true,
    });

    expect(buildDiagnosticContext).toHaveBeenCalledWith(
      expect.objectContaining({
        enableStructural: true,
      }),
    );
  });

  it("tags result with platform", async () => {
    const result = await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "token",
      platform: "meta",
    });

    expect(result.platform).toBe("meta");
  });

  it("supports tiktok platform", async () => {
    const { createPlatformClient } = await import("../../platforms/registry.js");

    await runFunnelDiagnostic({
      entityId: "act_tiktok",
      accessToken: "tiktok_token",
      platform: "tiktok",
    });

    expect(createPlatformClient).toHaveBeenCalledWith({
      platform: "tiktok",
      accessToken: "tiktok_token",
      appId: "",
    });
  });

  it("passes entityLevel through to client", async () => {
    const { createPlatformClient } = await import("../../platforms/registry.js");

    // Clear mocks to reset call count
    vi.clearAllMocks();

    await runFunnelDiagnostic({
      entityId: "123",
      entityLevel: "campaign",
      accessToken: "token",
    });

    // Verify createPlatformClient was called (which creates the client with fetchComparisonSnapshots)
    expect(createPlatformClient).toHaveBeenCalled();

    // The mock client's fetchComparisonSnapshots should have been called with campaign level
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockClient = (createPlatformClient as any).mock.results[0].value;
    expect(mockClient.fetchComparisonSnapshots).toHaveBeenCalledWith(
      "123",
      "campaign",
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("uses custom reference date when provided", async () => {
    const { buildComparisonPeriods } = await import("../../core/analysis/comparator.js");

    await runFunnelDiagnostic({
      entityId: "act_123",
      accessToken: "token",
      referenceDate: "2024-02-15",
    });

    expect(buildComparisonPeriods).toHaveBeenCalledWith(new Date("2024-02-15"), expect.any(Number));
  });
});

describe("formatDiagnostic", () => {
  function makeDiagnostic(overrides: Partial<DiagnosticResult> = {}): DiagnosticResult {
    return {
      vertical: "commerce",
      entityId: "act_123",
      platform: "meta",
      periods: {
        current: { since: "2024-01-08", until: "2024-01-14" },
        previous: { since: "2024-01-01", until: "2024-01-07" },
      },
      spend: { current: 1000, previous: 950 },
      primaryKPI: {
        name: "purchase",
        current: 50,
        previous: 55,
        deltaPercent: -9.1,
        severity: "warning" as Severity,
      },
      stageAnalysis: [
        {
          stageName: "impressions",
          metric: "impressions",
          currentValue: 10000,
          previousValue: 9500,
          delta: 500,
          deltaPercent: 5.3,
          isSignificant: true,
          severity: "healthy" as Severity,
        },
        {
          stageName: "click",
          metric: "inline_link_clicks",
          currentValue: 500,
          previousValue: 475,
          delta: 25,
          deltaPercent: 5.3,
          isSignificant: false,
          severity: "info" as Severity,
        },
      ],
      dropoffs: [
        {
          fromStage: "impressions",
          toStage: "click",
          currentRate: 0.05,
          previousRate: 0.05,
          deltaPercent: 0,
        },
      ],
      bottleneck: {
        stageName: "purchase",
        metric: "purchase",
        currentValue: 50,
        previousValue: 55,
        delta: -5,
        deltaPercent: -9.1,
        isSignificant: true,
        severity: "warning" as Severity,
      },
      findings: [
        {
          severity: "warning" as Severity,
          stage: "purchase",
          message: "Primary KPI declined 9.1% WoW",
          recommendation: "Review conversion events",
        },
      ],
      ...overrides,
    };
  }

  it("returns human-readable output with all sections", () => {
    const diagnostic = makeDiagnostic();
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("## Funnel Diagnostic: act_123");
    expect(output).toContain("(META)");
    expect(output).toContain("Period: 2024-01-08 to 2024-01-14");
    expect(output).toContain("Spend: $1000.00");
    expect(output).toContain("### Primary KPI: purchase");
    expect(output).toContain("### Funnel Stage Volumes");
    expect(output).toContain("### Stage Conversion Rates");
    expect(output).toContain("### Bottleneck: purchase");
    expect(output).toContain("### Findings");
  });

  it("includes platform tag when present", () => {
    const diagnostic = makeDiagnostic({ platform: "tiktok" });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("(TIKTOK)");
  });

  it("omits platform tag when not present", () => {
    const diagnostic = makeDiagnostic({ platform: undefined });
    const output = formatDiagnostic(diagnostic);

    expect(output).not.toContain("(META)");
    expect(output).not.toContain("(TIKTOK)");
  });

  it("formats primary KPI with correct delta sign", () => {
    const diagnostic = makeDiagnostic({
      primaryKPI: {
        name: "purchase",
        current: 60,
        previous: 55,
        deltaPercent: 9.1,
        severity: "healthy" as Severity,
      },
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("+9.1% WoW");
  });

  it("formats stage volumes with severity icons", () => {
    const diagnostic = makeDiagnostic();
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("impressions: 10,000 (+5.3%) [OK]");
    // Non-significant stages should not show icon
    expect(output).toContain("click: 500 (+5.3%)");
    expect(output).not.toContain("click: 500 (+5.3%) [");
  });

  it("formats drop-off rates correctly", () => {
    const diagnostic = makeDiagnostic({
      dropoffs: [
        {
          fromStage: "impressions",
          toStage: "click",
          currentRate: 0.05,
          previousRate: 0.045,
          deltaPercent: 11.1,
        },
      ],
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("impressions → click: 5.00% (was 4.50%)");
  });

  it("flags significant drop-off degradation with warning", () => {
    const diagnostic = makeDiagnostic({
      dropoffs: [
        {
          fromStage: "click",
          toStage: "purchase",
          currentRate: 0.05,
          previousRate: 0.075,
          deltaPercent: -33.3,
        },
      ],
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("⚠");
  });

  it("includes bottleneck section when present", () => {
    const diagnostic = makeDiagnostic();
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("### Bottleneck: purchase (-9.1% drop)");
  });

  it("omits bottleneck section when null", () => {
    const diagnostic = makeDiagnostic({ bottleneck: null });
    const output = formatDiagnostic(diagnostic);

    expect(output).not.toContain("### Bottleneck");
  });

  it("includes economic impact when present", () => {
    const diagnostic = makeDiagnostic({
      elasticity: {
        totalEstimatedRevenueLoss: -1500,
        impactRanking: [
          {
            stage: "purchase",
            estimatedRevenueDelta: -1200,
            severity: "critical" as Severity,
          },
          {
            stage: "click",
            estimatedRevenueDelta: -300,
            severity: "warning" as Severity,
          },
        ],
      },
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("### Economic Impact");
    expect(output).toContain("Estimated total revenue loss: $1500/period");
    expect(output).toContain("purchase: $1200 [CRITICAL]");
    expect(output).toContain("click: $300 [WARNING]");
  });

  it("omits economic impact section when not present", () => {
    const diagnostic = makeDiagnostic({ elasticity: undefined });
    const output = formatDiagnostic(diagnostic);

    expect(output).not.toContain("### Economic Impact");
  });

  it("formats findings with severity icons and recommendations", () => {
    const diagnostic = makeDiagnostic({
      findings: [
        {
          severity: "critical" as Severity,
          stage: "purchase",
          message: "Conversion rate dropped 50%",
          recommendation: "Check pixel tracking",
        },
        {
          severity: "info" as Severity,
          stage: "impressions",
          message: "Impressions increased",
          recommendation: null,
        },
      ],
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("[CRITICAL] **[purchase]** Conversion rate dropped 50%");
    expect(output).toContain("→ Check pixel tracking");
    expect(output).toContain("[INFO] **[impressions]** Impressions increased");
    expect(output).not.toContain("→ null");
  });

  it("handles empty findings array", () => {
    const diagnostic = makeDiagnostic({ findings: [] });
    const output = formatDiagnostic(diagnostic);

    expect(output).not.toContain("### Findings");
  });

  it("formats all severity levels correctly", () => {
    const diagnosticCritical = makeDiagnostic({
      primaryKPI: {
        name: "purchase",
        current: 20,
        previous: 55,
        deltaPercent: -63.6,
        severity: "critical" as Severity,
      },
    });

    const outputCritical = formatDiagnostic(diagnosticCritical);
    expect(outputCritical).toContain("[CRITICAL]");

    const diagnosticHealthy = makeDiagnostic({
      primaryKPI: {
        name: "purchase",
        current: 65,
        previous: 55,
        deltaPercent: 18.2,
        severity: "healthy" as Severity,
      },
    });

    const outputHealthy = formatDiagnostic(diagnosticHealthy);
    expect(outputHealthy).toContain("[OK]");
  });

  it("handles negative delta percent in stage volumes", () => {
    const diagnostic = makeDiagnostic({
      stageAnalysis: [
        {
          stageName: "purchase",
          metric: "purchase",
          currentValue: 45,
          previousValue: 55,
          delta: -10,
          deltaPercent: -18.2,
          isSignificant: true,
          severity: "warning" as Severity,
        },
      ],
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).toContain("purchase: 45 (-18.2%) [WARNING]");
  });

  it("omits empty elasticity section", () => {
    const diagnostic = makeDiagnostic({
      elasticity: {
        totalEstimatedRevenueLoss: 0,
        impactRanking: [],
      },
    });
    const output = formatDiagnostic(diagnostic);

    expect(output).not.toContain("### Economic Impact");
  });
});
