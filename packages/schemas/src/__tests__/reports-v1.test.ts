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
  PaidVisitRow,
  AttributionBasis,
  ReceiptedBookingQualityData,
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
          inlineLinkClicks: 90,
          costPerInlineLinkClick: 1.11,
          inlineLinkClickCtr: 1.29,
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
      heldRate: { attended: 38, matured: 45, rate: 38 / 45 },
      consentCompleteness: { validConsent: 42, bookable: 45, rate: 42 / 45 },
      recoveryCandidates: { noShows: 3 },
      receiptedBookings: { count: 41 },
      receiptedBookingQuality: {
        cohortSize: 41,
        confidence: { deterministic: 18, high: 12, medium: 7, low: 3, unattributed: 1 },
        exceptions: {
          missing_source: 1,
          missing_consent: 2,
          manual_override: 0,
          duplicate_contact_risk: 1,
        },
        bookingsNeedingAttention: 4,
        worklist: [],
      },
      receiptedBookingRevenue: {
        revenueCents: 6150000,
        currency: "SGD",
        bookingsWithValue: 38,
        cohortSize: 41,
        paidRevenueCents: 2870000,
        paidBookings: 19,
      },
    };
    expect(sample.managedComparison).toBeNull();
    expect(sample.receiptedBookings.count).toBe(41);
    expect(sample.receiptedBookingQuality.cohortSize).toBe(41);
  });

  it("ReceiptedBookingQualityData carries a per-booking worklist", () => {
    const quality: ReceiptedBookingQualityData = {
      cohortSize: 3,
      confidence: { deterministic: 1, high: 0, medium: 0, low: 0, unattributed: 2 },
      exceptions: {
        missing_source: 2,
        missing_consent: 1,
        manual_override: 0,
        duplicate_contact_risk: 0,
      },
      bookingsNeedingAttention: 2,
      worklist: [
        {
          bookingId: "bk-1",
          service: "Botox consult",
          startsAt: "2026-06-16T02:00:00.000Z",
          attributionConfidence: "unattributed",
          openExceptionCodes: ["missing_source", "missing_consent"],
          issuedAt: null,
          overridden: false,
        },
      ],
    };
    expect(quality.worklist).toHaveLength(1);
    expect(quality.worklist[0]?.openExceptionCodes).toContain("missing_source");
    expect(quality.worklist[0]?.startsAt).toBe("2026-06-16T02:00:00.000Z");
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

  it("CampaignRow has efficiency metrics (costPerInlineLinkClick, inlineLinkClickCtr, cpl, clickToLeadRate)", () => {
    const c: CampaignRow = {
      name: "x",
      spend: 100,
      impressions: 7000,
      inlineLinkClicks: 90,
      costPerInlineLinkClick: 1.11,
      inlineLinkClickCtr: 1.29,
      leads: 3,
      revenue: 0,
      cpl: 33.33,
      clickToLeadRate: 0.033,
      roas: 0,
    };
    expect(c.costPerInlineLinkClick).toBe(1.11);
    expect(c.inlineLinkClickCtr).toBe(1.29);
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

describe("PaidVisitRow (1A-6)", () => {
  it("accepts a ctwa_captured paid visit row in major units", () => {
    const basis: AttributionBasis = "ctwa_captured";
    const row: PaidVisitRow = {
      bookingId: "bk-1",
      amountMajor: 500,
      currency: "SGD",
      campaignId: "camp-1",
      campaignName: "camp-1",
      attributionBasis: basis,
      paidAt: "2026-06-01T00:00:00.000Z",
    };
    expect(row.amountMajor).toBe(500);
    expect(row.attributionBasis).toBe("ctwa_captured");
  });

  it("allows campaign_missing with null campaign fields", () => {
    const row: PaidVisitRow = {
      bookingId: "bk-2",
      amountMajor: 120.5,
      currency: "SGD",
      campaignId: null,
      campaignName: null,
      attributionBasis: "campaign_missing",
      paidAt: "2026-06-02T00:00:00.000Z",
    };
    expect(row.campaignId).toBeNull();
    expect(row.attributionBasis).toBe("campaign_missing");
  });
});
