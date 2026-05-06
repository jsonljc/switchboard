import { describe, expect, it } from "vitest";
import type {
  ReportDataV1,
  ReportWindow,
  PullQuoteCopy,
  AttributionData,
  FunnelRowData,
  CampaignRow,
  CostBreakdown,
  ManagedComparisonData,
  ManagedComparisonPair,
  Delta,
} from "../reports/v1.js";
import { REPORT_WINDOWS, DEFAULT_REPORT_WINDOW } from "../reports/v1.js";

describe("ReportDataV1 (PR-R1 locked shape)", () => {
  it("REPORT_WINDOWS is a 3-element tuple", () => {
    expect(REPORT_WINDOWS).toEqual(["THIS WEEK", "THIS MONTH", "THIS QUARTER"]);
  });

  it("DEFAULT_REPORT_WINDOW is THIS MONTH", () => {
    expect(DEFAULT_REPORT_WINDOW).toBe("THIS MONTH");
  });

  it("a fully-populated ReportDataV1 satisfies the type", () => {
    const sample: ReportDataV1 = {
      label: "THIS MONTH",
      period: "APR 1 — APR 30",
      dateFolio: "APR 1 — APR 30",
      pullquote: {
        pre: "Your team earned ",
        value: "$1,000",
        mid: " for ",
        cost: "$100",
        post: ".",
      },
      attribution: {
        total: 1000,
        delta: { kind: "pos", text: "Up 10%" },
        riley: { value: 600, caption: "ad-driven leads converted" },
        alex: { value: 400, caption: "lead replies converted" },
      },
      funnel: [
        { stage: "Impressions", n: 100, label: "100", delta: null },
        { stage: "Clicks", n: 10, label: "10", delta: null },
        { stage: "Landing visits", n: 9, label: "9", delta: null },
        { stage: "Leads", n: 3, label: "3", delta: null },
        { stage: "Bookings", n: 1, label: "1", delta: null },
      ],
      funnelNarrative: { marker: "Riley · Apr 22", text: "All clear." },
      campaigns: [
        {
          name: "Test",
          spend: 100,
          impressions: 7000,
          clicks: 90,
          cpc: 1.11,
          ctr: 1.29,
          leads: 3,
          revenue: 1000,
          cpl: 33.33,
          clickToLeadRate: 0.033,
          roas: 10,
        },
      ],
      cost: { paid: 100, alt: 8000, saving: 7900 },
      costNarrative: "vs. SDR + agency",
      managedComparison: null,
    };
    expect(sample.managedComparison).toBeNull();
  });

  it("ManagedComparisonData accepts an in-period-cohort source", () => {
    const cmp: ManagedComparisonData = {
      ads: {
        managed: { spend: 100, revenue: 500, roas: 5 },
        unmanaged: { spend: 100, revenue: 200, roas: 2 },
        delta: { kind: "pos", text: "+3.0x" },
      } satisfies ManagedComparisonPair,
      conversations: null,
      source: "in-period-cohort",
    };
    expect(cmp.ads?.managed.roas).toBe(5);
  });

  it("ReportWindow is a string-literal union (compile-time assertion)", () => {
    const w: ReportWindow = "THIS WEEK";
    expect(typeof w).toBe("string");
  });

  it("PullQuoteCopy has 5 string slots", () => {
    const q: PullQuoteCopy = { pre: "", value: "", mid: "", cost: "", post: "" };
    expect(Object.keys(q).sort()).toEqual(["cost", "mid", "post", "pre", "value"]);
  });

  it("Delta kind is pos|flat|neg", () => {
    const d: Delta = { kind: "flat", text: "Roughly flat" };
    expect(d.kind).toBe("flat");
  });

  it("CampaignRow has efficiency metrics (cpc, ctr, cpl, clickToLeadRate)", () => {
    const c: CampaignRow = {
      name: "x",
      spend: 100,
      impressions: 7000,
      clicks: 90,
      cpc: 1.11,
      ctr: 1.29,
      leads: 3,
      revenue: 0,
      cpl: 33.33,
      clickToLeadRate: 0.033,
      roas: 0,
    };
    expect(c.cpc).toBe(1.11);
    expect(c.ctr).toBe(1.29);
    expect(c.cpl).toBe(33.33);
    expect(c.clickToLeadRate).toBe(0.033);
  });

  it("AttributionData.delta accepts all three kinds", () => {
    const samples: AttributionData["delta"][] = [
      { kind: "pos", text: "" },
      { kind: "flat", text: "" },
      { kind: "neg", text: "" },
    ];
    expect(samples).toHaveLength(3);
  });

  it("FunnelRowData.delta is null-or-Delta", () => {
    const r1: FunnelRowData = { stage: "x", n: 0, label: "0", delta: null };
    const r2: FunnelRowData = { stage: "x", n: 0, label: "0", delta: { kind: "pos", text: "↑" } };
    expect(r1.delta).toBeNull();
    expect(r2.delta).not.toBeNull();
  });

  it("CostBreakdown has paid/alt/saving as numbers", () => {
    const b: CostBreakdown = { paid: 100, alt: 8000, saving: 7900 };
    expect(b.alt - b.paid).toBe(b.saving);
  });
});
