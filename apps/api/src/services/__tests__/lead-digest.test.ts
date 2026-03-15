import { describe, it, expect } from "vitest";
import { formatDigestFromSummary } from "../lead-digest.js";
import type { OperatorSummary } from "../operator-summary.js";

function createMockSummary(overrides: Partial<OperatorSummary> = {}): OperatorSummary {
  return {
    organizationId: "org_1",
    spend: {
      source: "meta",
      currency: "USD",
      connectionStatus: "connected",
      today: 50,
      last7Days: 350,
      last30Days: 761.4,
      trend: [],
      freshness: { fetchedAt: new Date().toISOString(), cacheTtlSeconds: 300 },
    },
    outcomes: {
      leads30d: 47,
      qualifiedLeads30d: 31,
      bookings30d: 18,
      revenue30d: null,
      costPerLead30d: 16.2,
      costPerQualifiedLead30d: 24.56,
      costPerBooking30d: 42.3,
    },
    operator: { actionsToday: 5, deniedToday: 1 },
    speedToLead: {
      averageMs: 15000,
      p50Ms: 12000,
      p95Ms: 45000,
      percentWithin60s: 94,
      sampleSize: 50,
    },
    ...overrides,
  };
}

describe("LeadBotDigestGenerator", () => {
  const periodStart = new Date("2026-03-09");
  const periodEnd = new Date("2026-03-15");

  it("generates digest with all metrics", () => {
    const summary = createMockSummary();
    const priorMetrics = { leads: 42, bookings: 15, costPerBooking: 46.0 };

    const digest = formatDigestFromSummary(summary, priorMetrics, periodStart, periodEnd);

    expect(digest.organizationId).toBe("org_1");
    expect(digest.metrics.totalLeads).toBe(47);
    expect(digest.metrics.qualifiedLeads).toBe(31);
    expect(digest.metrics.bookings).toBe(18);
    expect(digest.metrics.qualificationRate).toBe(66); // 31/47 * 100
    expect(digest.metrics.bookingRate).toBe(38); // 18/47 * 100
    expect(digest.metrics.speedToLeadPercent).toBe(94);
    expect(digest.metrics.costPerBooking).toBe(42.3);
    expect(digest.metrics.spend).toBe(761.4);
  });

  it("computes week-over-week changes correctly", () => {
    const summary = createMockSummary();
    const priorMetrics = { leads: 42, bookings: 15, costPerBooking: 46.0 };

    const digest = formatDigestFromSummary(summary, priorMetrics, periodStart, periodEnd);

    // (47-42)/42 * 100 = 11.9 → 12
    expect(digest.weekOverWeek.leadsChange).toBe(12);
    // (18-15)/15 * 100 = 20
    expect(digest.weekOverWeek.bookingsChange).toBe(20);
    // (42.3-46)/46 * 100 = -8.04 → -8
    expect(digest.weekOverWeek.costPerBookingChange).toBe(-8);
  });

  it("returns null changes when prior period has zero values", () => {
    const summary = createMockSummary();
    const priorMetrics = { leads: 0, bookings: 0, costPerBooking: null };

    const digest = formatDigestFromSummary(summary, priorMetrics, periodStart, periodEnd);

    expect(digest.weekOverWeek.leadsChange).toBeNull();
    expect(digest.weekOverWeek.bookingsChange).toBeNull();
    expect(digest.weekOverWeek.costPerBookingChange).toBeNull();
  });

  it("formatted message contains key metrics", () => {
    const summary = createMockSummary();
    const priorMetrics = { leads: 42, bookings: 15, costPerBooking: 46.0 };

    const digest = formatDigestFromSummary(summary, priorMetrics, periodStart, periodEnd);

    expect(digest.formattedMessage).toContain("Weekly Report");
    expect(digest.formattedMessage).toContain("Leads: 47");
    expect(digest.formattedMessage).toContain("Qualified: 31 (66%)");
    expect(digest.formattedMessage).toContain("Booked: 18 (38%)");
    expect(digest.formattedMessage).toContain("94% within 60s");
    expect(digest.formattedMessage).toContain("$42.30");
    expect(digest.formattedMessage).toContain("$761.40");
  });

  it("handles zero leads gracefully", () => {
    const summary = createMockSummary({
      outcomes: {
        leads30d: 0,
        qualifiedLeads30d: 0,
        bookings30d: 0,
        revenue30d: null,
        costPerLead30d: null,
        costPerQualifiedLead30d: null,
        costPerBooking30d: null,
      },
    });
    const priorMetrics = { leads: 0, bookings: 0, costPerBooking: null };

    const digest = formatDigestFromSummary(summary, priorMetrics, periodStart, periodEnd);

    expect(digest.metrics.qualificationRate).toBe(0);
    expect(digest.metrics.bookingRate).toBe(0);
    expect(digest.formattedMessage).toContain("Leads: 0");
  });

  it("omits speed-to-lead line when percentWithin60s is null", () => {
    const summary = createMockSummary({
      speedToLead: {
        averageMs: null,
        p50Ms: null,
        p95Ms: null,
        percentWithin60s: null,
        sampleSize: 0,
      },
    });
    const priorMetrics = { leads: 0, bookings: 0, costPerBooking: null };

    const digest = formatDigestFromSummary(summary, priorMetrics, periodStart, periodEnd);

    expect(digest.formattedMessage).not.toContain("Speed to lead");
  });
});
