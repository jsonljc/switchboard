// ---------------------------------------------------------------------------
// Sales Process Scorer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { scoreSalesProcess } from "../sales-process.js";
import type { NormalizedData, CrmSummary } from "@switchboard/schemas";

function makeData(overrides: Partial<NormalizedData> = {}): NormalizedData {
  return {
    accountId: "acc_1",
    organizationId: "org_1",
    collectedAt: new Date().toISOString(),
    dataTier: "PARTIAL",
    adMetrics: null,
    funnelEvents: [],
    creativeAssets: null,
    crmSummary: null,
    signalHealth: null,
    headroom: null,
    ...overrides,
  };
}

function makeCrm(overrides: Partial<CrmSummary> = {}): CrmSummary {
  return {
    totalLeads: 200,
    matchedLeads: 100,
    matchRate: 0.5,
    openDeals: 20,
    averageDealValue: 1000,
    averageTimeToFirstContact: 4,
    leadToCloseRate: 0.1,
    stageConversionRates: null,
    averageDaysToClose: null,
    adAttributedLeads: null,
    followUpWithin24hRate: null,
    ...overrides,
  };
}

describe("scoreSalesProcess", () => {
  it("returns score 0 with NO_CRM_DATA issue when no CRM summary", () => {
    const result = scoreSalesProcess(makeData());

    expect(result.scorerName).toBe("sales-process");
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe("NO_CRM_DATA");
  });

  it("scores highly with healthy CRM data", () => {
    const data = makeData({
      dataTier: "FULL",
      crmSummary: makeCrm({
        matchedLeads: 160,
        matchRate: 0.8,
        averageTimeToFirstContact: 2,
        leadToCloseRate: 0.15,
        stageConversionRates: { qualify: 0.6, propose: 0.5, close: 0.4 },
        averageDaysToClose: 30,
        adAttributedLeads: 100,
        followUpWithin24hRate: 0.8,
      }),
    });

    const result = scoreSalesProcess(data);

    expect(result.score).toBeGreaterThan(60);
    expect(result.confidence).toBe("HIGH");
  });

  it("detects critical lead-to-close rate (< 2%)", () => {
    const data = makeData({
      crmSummary: makeCrm({ leadToCloseRate: 0.01 }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "LEAD_TO_CLOSE_CRITICAL")).toBe(true);
  });

  it("warns about low lead-to-close rate (2-5%)", () => {
    const data = makeData({
      crmSummary: makeCrm({ leadToCloseRate: 0.03 }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "LEAD_TO_CLOSE_WARNING")).toBe(true);
  });

  it("detects critical follow-up velocity (>= 48h)", () => {
    const data = makeData({
      crmSummary: makeCrm({ averageTimeToFirstContact: 72 }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "FOLLOWUP_VELOCITY_CRITICAL")).toBe(true);
  });

  it("warns about slow follow-up (24-48h)", () => {
    const data = makeData({
      crmSummary: makeCrm({ averageTimeToFirstContact: 36 }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "FOLLOWUP_VELOCITY_WARNING")).toBe(true);
  });

  it("detects critical CRM match rate (< 20%)", () => {
    const data = makeData({
      crmSummary: makeCrm({ matchedLeads: 20, matchRate: 0.1, openDeals: 5 }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "CRM_ATTRIBUTION_CRITICAL")).toBe(true);
  });

  it("detects critical 24h follow-up rate", () => {
    const data = makeData({
      crmSummary: makeCrm({ followUpWithin24hRate: 0.2 }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "FOLLOWUP_24H_CRITICAL")).toBe(true);
  });

  it("detects pipeline stage bottleneck", () => {
    const data = makeData({
      crmSummary: makeCrm({
        stageConversionRates: { qualify: 0.5, propose: 0.05, close: 0.3 },
      }),
    });

    const result = scoreSalesProcess(data);

    expect(result.issues.some((i) => i.code === "PIPELINE_STAGE_BOTTLENECK")).toBe(true);
  });

  it("populates breakdown with all sub-scores", () => {
    const data = makeData({
      crmSummary: makeCrm({
        stageConversionRates: { qualify: 0.5, propose: 0.4, close: 0.3 },
      }),
    });

    const result = scoreSalesProcess(data);

    expect(result.breakdown).toHaveProperty("leadToClose");
    expect(result.breakdown).toHaveProperty("followupVelocity");
    expect(result.breakdown).toHaveProperty("matchRate");
    expect(result.breakdown).toHaveProperty("pipelineConsistency");
  });

  it("scores between 0 and 100", () => {
    const data = makeData({
      crmSummary: makeCrm(),
    });

    const result = scoreSalesProcess(data);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
