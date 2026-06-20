import { describe, it, expect } from "vitest";
import { buildWeeklyDigest, renderWeeklyDigestText } from "./weekly-digest.js";
import type {
  ReportDataV1,
  ReceiptedBookingWorklistItem,
  WeeklyDigest,
  WeeklyDigestMetric,
} from "@switchboard/schemas";

function makeReport(over: Partial<ReportDataV1> = {}): ReportDataV1 {
  return {
    label: "THIS WEEK",
    period: "Jun 9 to Jun 15",
    dateFolio: "Jun 9 to Jun 15",
    pullquote: { pre: "", value: "", mid: "", cost: "", post: "" },
    attribution: {
      total: 0,
      delta: { kind: "flat", text: "" },
      riley: { value: 0, caption: "" },
      alex: { value: 0, caption: "" },
    },
    funnel: [],
    funnelNarrative: { marker: "", text: "" },
    campaigns: [],
    cost: { paid: 0, alt: 0, saving: 0 },
    costNarrative: "",
    managedComparison: null,
    heldRate: { attended: 0, matured: 0, rate: null },
    consentCompleteness: { validConsent: 0, bookable: 0, rate: null },
    recoveryCandidates: { noShows: 0 },
    receiptedBookings: { count: 0 },
    receiptedBookingQuality: {
      cohortSize: 0,
      confidence: { deterministic: 0, high: 0, medium: 0, low: 0, unattributed: 0 },
      exceptions: {
        missing_source: 0,
        missing_consent: 0,
        manual_override: 0,
        duplicate_contact_risk: 0,
      },
      bookingsNeedingAttention: 0,
      worklist: [],
    },
    receiptedBookingRevenue: {
      revenueCents: 0,
      currency: null,
      bookingsWithValue: 0,
      cohortSize: 0,
      paidRevenueCents: 0,
      paidBookings: 0,
    },
    ...over,
  };
}

const opts = { periodLabel: "Jun 9 to Jun 15", dashboardUrl: "https://app.example/reports" };

function metric(digest: WeeklyDigest, key: string): WeeklyDigestMetric {
  const found = digest.metrics.find((m) => m.key === key);
  if (!found) throw new Error(`missing metric: ${key}`);
  return found;
}

describe("buildWeeklyDigest", () => {
  it("summarizes a populated week into subject, metrics, and worklist", () => {
    const report = makeReport({
      receiptedBookings: { count: 12 },
      receiptedBookingRevenue: {
        revenueCents: 345000,
        currency: "USD",
        bookingsWithValue: 9,
        cohortSize: 12,
        paidRevenueCents: 180000,
        paidBookings: 5,
      },
      receiptedBookingQuality: {
        cohortSize: 12,
        confidence: { deterministic: 5, high: 2, medium: 1, low: 0, unattributed: 4 },
        exceptions: {
          missing_source: 4,
          missing_consent: 0,
          manual_override: 0,
          duplicate_contact_risk: 1,
        },
        bookingsNeedingAttention: 4,
        worklist: [
          {
            bookingId: "b1",
            service: "Botox consult",
            startsAt: "2026-06-09T14:00:00.000Z",
            attributionConfidence: "unattributed",
            openExceptionCodes: ["missing_source"],
            issuedAt: null,
            overridden: false,
          },
        ],
      },
      heldRate: { attended: 38, matured: 45, rate: 38 / 45 },
      consentCompleteness: { validConsent: 30, bookable: 40, rate: 0.75 },
    });

    const d = buildWeeklyDigest(report, opts);

    expect(d.subject).toBe("Your week: 12 receipted bookings, $3,450.00 booked");
    expect(d.headline).toContain("Jun 9 to Jun 15");

    expect(metric(d, "receipted_bookings").value).toBe("12");
    // Proven-paid is surfaced as its own prominent metric (the north-star headline).
    expect(metric(d, "paid_revenue").value).toBe("$1,800.00");
    expect(metric(d, "paid_revenue").detail).toBe("5 of 12 bookings paid");
    // Expected stays as the secondary "booked" dimension (relabeled, same key).
    expect(metric(d, "receipted_revenue").value).toBe("$3,450.00");
    expect(metric(d, "receipted_revenue").detail).toBe("9 of 12 carried a value");
    expect(metric(d, "attribution_quality").value).toBe(
      "5 deterministic, 2 high, 1 medium, 4 unattributed",
    );
    expect(metric(d, "needs_attention").value).toBe("4");
    expect(metric(d, "held_rate").value).toBe("84%");
    expect(metric(d, "held_rate").detail).toBe("38 of 45 attended");
    expect(metric(d, "consent_completeness").value).toBe("75%");

    expect(d.attention).toEqual([
      {
        service: "Botox consult",
        when: "Tue, Jun 9",
        confidence: "unattributed",
        issues: "missing source",
      },
    ]);
    // worklist (1 shown) is smaller than bookingsNeedingAttention (4) -> honest "first N of M".
    expect(d.attentionNote).toBe("Showing first 1 of 4 bookings that need attention.");
  });

  it("renders honest nulls and zeros for an empty week (never NaN)", () => {
    const d = buildWeeklyDigest(makeReport(), opts);

    expect(d.subject).toBe("Your week: no receipted bookings yet");

    expect(metric(d, "receipted_bookings").value).toBe("0");
    expect(metric(d, "paid_revenue").value).toBe("$0.00");
    expect(metric(d, "paid_revenue").detail).toBe("0 of 0 bookings paid");
    expect(metric(d, "receipted_revenue").value).toBe("$0.00");
    expect(metric(d, "attribution_quality").value).toBe("no data yet");
    expect(metric(d, "held_rate").value).toBe("no matured bookings yet");
    expect(metric(d, "consent_completeness").value).toBe("no applicable contacts yet");

    expect(d.attention).toEqual([]);
    expect(d.attentionNote).toBeNull();

    const text = renderWeeklyDigestText(d);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/[–—]/);
    expect(text).toContain("https://app.example/reports");
    expect(text).toContain("Jun 9 to Jun 15");
  });

  it("uses singular grammar and omits revenue from the subject when zero", () => {
    const d = buildWeeklyDigest(
      makeReport({
        receiptedBookings: { count: 1 },
        receiptedBookingRevenue: {
          revenueCents: 0,
          currency: null,
          bookingsWithValue: 0,
          cohortSize: 1,
          paidRevenueCents: 0,
          paidBookings: 0,
        },
      }),
      opts,
    );
    expect(d.subject).toBe("Your week: 1 receipted booking");
  });

  it("guards a non-finite revenue figure to zero, never NaN", () => {
    const d = buildWeeklyDigest(
      makeReport({
        receiptedBookings: { count: 3 },
        receiptedBookingRevenue: {
          revenueCents: Number.NaN,
          currency: "USD",
          bookingsWithValue: 0,
          cohortSize: 3,
          paidRevenueCents: Number.NaN,
          paidBookings: 0,
        },
      }),
      opts,
    );
    expect(metric(d, "receipted_revenue").value).toBe("$0.00");
    // The paid figure is NaN-guarded to $0.00 the same way as the expected figure.
    expect(metric(d, "paid_revenue").value).toBe("$0.00");
  });

  it("formats a non-USD currency and caps the worklist with an honest note", () => {
    const items: ReceiptedBookingWorklistItem[] = Array.from({ length: 8 }, (_unused, i) => ({
      bookingId: `b${i}`,
      service: "Filler",
      startsAt: "2026-06-10T09:00:00.000Z",
      attributionConfidence: "low",
      openExceptionCodes: ["missing_consent"],
      issuedAt: null,
      overridden: false,
    }));
    const d = buildWeeklyDigest(
      makeReport({
        receiptedBookings: { count: 20 },
        receiptedBookingRevenue: {
          revenueCents: 500000,
          currency: "SGD",
          bookingsWithValue: 20,
          cohortSize: 20,
          paidRevenueCents: 250000,
          paidBookings: 10,
        },
        receiptedBookingQuality: {
          cohortSize: 20,
          confidence: { deterministic: 0, high: 0, medium: 0, low: 20, unattributed: 0 },
          exceptions: {
            missing_source: 0,
            missing_consent: 8,
            manual_override: 0,
            duplicate_contact_risk: 0,
          },
          bookingsNeedingAttention: 8,
          worklist: items,
        },
      }),
      { ...opts, maxAttentionItems: 5 },
    );
    expect(metric(d, "receipted_revenue").value).toContain("5,000.00");
    expect(d.attention).toHaveLength(5);
    expect(d.attentionNote).toBe("Showing first 5 of 8 bookings that need attention.");
  });

  it("notes the total honestly when no worklist items are shown", () => {
    const d = buildWeeklyDigest(
      makeReport({
        receiptedBookings: { count: 6 },
        receiptedBookingQuality: {
          cohortSize: 6,
          confidence: { deterministic: 0, high: 0, medium: 0, low: 0, unattributed: 6 },
          exceptions: {
            missing_source: 6,
            missing_consent: 0,
            manual_override: 0,
            duplicate_contact_risk: 0,
          },
          bookingsNeedingAttention: 6,
          worklist: [
            {
              bookingId: "b1",
              service: "Botox consult",
              startsAt: "2026-06-09T14:00:00.000Z",
              attributionConfidence: "unattributed",
              openExceptionCodes: ["missing_source"],
              issuedAt: null,
              overridden: false,
            },
          ],
        },
      }),
      { ...opts, maxAttentionItems: 0 },
    );
    expect(d.attention).toEqual([]);
    expect(d.attentionNote).toBe("6 bookings need attention.");
  });

  it("surfaces Riley ad-economics (attributed revenue, ad spend, blended ROAS) from the report", () => {
    const d = buildWeeklyDigest(
      makeReport({
        attribution: {
          total: 9000,
          delta: { kind: "pos", text: "+10 %" },
          riley: { value: 6000, caption: "2 campaigns · 14 leads" },
          alex: { value: 3000, caption: "chat · 7 leads" },
        },
        campaigns: [
          {
            name: "Botox Promo",
            spend: 1500,
            impressions: 10000,
            inlineLinkClicks: 200,
            costPerInlineLinkClick: 7.5,
            inlineLinkClickCtr: 0.02,
            leads: 10,
            revenue: 4500,
            cpl: 150,
            clickToLeadRate: 0.05,
            roas: 3,
          },
          {
            name: "Filler Launch",
            spend: 500,
            impressions: 4000,
            inlineLinkClicks: 80,
            costPerInlineLinkClick: 6.25,
            inlineLinkClickCtr: 0.02,
            leads: 4,
            revenue: 1500,
            cpl: 125,
            clickToLeadRate: 0.05,
            roas: 3,
          },
        ],
      }),
      opts,
    );

    // Attributed revenue comes from attribution.riley.value (major units), with the campaign/lead caption.
    expect(metric(d, "riley_attributed_revenue").value).toBe("$6,000.00");
    expect(metric(d, "riley_attributed_revenue").detail).toBe("2 campaigns · 14 leads");

    // Ad spend is the sum of campaign spend; detail counts the campaigns.
    expect(metric(d, "ad_spend").value).toBe("$2,000.00");
    expect(metric(d, "ad_spend").detail).toBe("2 campaigns");

    // Blended ROAS = total campaign revenue / total campaign spend = 6000 / 2000 = 3.0x.
    expect(metric(d, "roas").value).toBe("3.0x");
    expect(metric(d, "roas").detail).toBe("$6,000.00 from $2,000.00 spent");

    // The economics lines render in the plain-text body, em-dash-free.
    const text = renderWeeklyDigestText(d);
    expect(text).toContain("Riley attributed revenue: $6,000.00");
    expect(text).toContain("Ad spend: $2,000.00");
    expect(text).toContain("Return on ad spend: 3.0x");
    expect(text).not.toMatch(/[–—]/);
  });

  it("renders honest economics with no campaigns and no Riley revenue (never NaN)", () => {
    const d = buildWeeklyDigest(makeReport(), opts);

    expect(metric(d, "riley_attributed_revenue").value).toBe("$0.00");
    expect(metric(d, "ad_spend").value).toBe("$0.00");
    expect(metric(d, "ad_spend").detail).toBe("no campaigns yet");
    // No ad spend -> ROAS is undefined; render an honest phrase rather than NaN/Infinity.
    expect(metric(d, "roas").value).toBe("no ad spend yet");
    expect(metric(d, "roas").detail).toBeUndefined();

    const text = renderWeeklyDigestText(d);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });

  it("guards non-finite economics figures to safe values, never NaN", () => {
    const d = buildWeeklyDigest(
      makeReport({
        attribution: {
          total: Number.NaN,
          delta: { kind: "flat", text: "" },
          riley: { value: Number.NaN, caption: "1 campaign · 0 leads" },
          alex: { value: 0, caption: "chat · 0 leads" },
        },
        campaigns: [
          {
            name: "Broken Feed",
            spend: Number.NaN,
            impressions: 0,
            inlineLinkClicks: 0,
            costPerInlineLinkClick: 0,
            inlineLinkClickCtr: 0,
            leads: 0,
            revenue: Number.NaN,
            cpl: null,
            clickToLeadRate: null,
            roas: 0,
          },
        ],
      }),
      opts,
    );

    expect(metric(d, "riley_attributed_revenue").value).toBe("$0.00");
    expect(metric(d, "ad_spend").value).toBe("$0.00");
    // Non-finite spend sums to zero -> ROAS undefined -> honest phrase, never NaN.
    expect(metric(d, "roas").value).toBe("no ad spend yet");

    const text = renderWeeklyDigestText(d);
    expect(text).not.toContain("NaN");
  });
});
