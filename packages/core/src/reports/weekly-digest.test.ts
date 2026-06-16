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
        },
      }),
      opts,
    );
    expect(metric(d, "receipted_revenue").value).toBe("$0.00");
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
});
