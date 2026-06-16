import { describe, it, expect } from "vitest";
import { assembleWeeklyReport, completedWeekRange } from "./assemble-weekly-report.js";
import {
  buildWeeklyDigest,
  renderWeeklyDigestText,
  createInMemoryReportCacheStore,
  createInMemoryBaselineStore,
  type ReportStores,
} from "@switchboard/core/reports";

/**
 * completedWeekRange returns the most recent fully-elapsed Mon 00:00:00 .. Sun
 * 23:59:59.999 UTC week, exclusive-end at the following Monday 00:00:00.
 */
describe("completedWeekRange", () => {
  it("given a mid-week Wednesday, returns the prior Mon..Sun (the week that just completed)", () => {
    // Wed 2026-06-17 12:00 UTC. The week containing it (Mon Jun 15 .. Sun Jun 21) is
    // still in progress, so the most recent COMPLETED week is Mon Jun 8 .. Sun Jun 14.
    const now = new Date("2026-06-17T12:00:00.000Z");
    const { start, end } = completedWeekRange(now);

    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    // Exclusive end = next Monday 00:00:00 (Mon Jun 15).
    expect(end.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("given a Monday, returns the immediately preceding full week (not the in-progress one)", () => {
    // Mon 2026-06-15 09:00 UTC. The current week starts today, so the last completed
    // week is Mon Jun 8 .. Sun Jun 14.
    const now = new Date("2026-06-15T09:00:00.000Z");
    const { start, end } = completedWeekRange(now);

    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("given a Sunday late in the day, still returns the prior completed week", () => {
    // Sun 2026-06-21 23:30 UTC is the last day of the IN-PROGRESS week (Mon Jun 15..Sun Jun 21),
    // so the most recent completed week remains Mon Jun 8 .. Sun Jun 14.
    const now = new Date("2026-06-21T23:30:00.000Z");
    const { start, end } = completedWeekRange(now);

    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("spans exactly 7 days (exclusive end)", () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    const { start, end } = completedWeekRange(now);
    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(7);
  });
});

// Stubbed report stores modeled on packages/core/src/reports/period-rollup.test.ts: the real rollup
// runs (every compute* fn executes), only the Prisma-backed reads are stubbed. This pins the
// createPeriodRollup -> buildWeeklyDigest producer/consumer seam that the delivery-service test
// (which injects a fake report) does not exercise.
function stubStores(): ReportStores {
  return {
    revenue: {
      sumByOrg: async () => ({ totalAmount: 0, count: 0 }),
      revenueWithFirstTouch: async () => [],
      revenueByCampaign: async () => [],
    },
    bookings: {
      countExcludingStatuses: async () => 0,
      countMaturedAttendance: async () => ({ matured: 12, attended: 9 }),
    },
    opportunities: { countClosedWon: async () => 0 },
    conversions: { countByType: async () => 0, leadsBySource: async () => [] },
    recommendations: { latestByAgent: async () => null },
    orgConfig: { getStripePriceId: async () => null },
    conversations: { threadCountsByAgent: async () => [] },
    deployment: { getAlexSlug: async () => null },
    contacts: { countConsentCompleteness: async () => ({ bookable: 20, validConsent: 16 }) },
    receipts: { countReceiptedBookingsInWindow: async () => 7 },
    receiptedBookings: { listForCohort: async () => [] },
  };
}

describe("assembleWeeklyReport -> buildWeeklyDigest (producer/consumer seam)", () => {
  it("runs the real rollup and renders a digest from every field it produces", async () => {
    const now = new Date("2026-06-17T13:00:00.000Z");
    const report = await assembleWeeklyReport(
      {
        stores: stubStores(),
        reportCache: createInMemoryReportCacheStore(),
        baselineStore: createInMemoryBaselineStore(),
      },
      "org-1",
      now,
    );

    // The real createPeriodRollup populated the receipted-bookings / held-rate / consent fields the
    // digest reads; a fake report (as in the delivery-service test) would not catch a rollup that
    // stopped populating one of them.
    expect(report.receiptedBookings.count).toBe(7);

    const digest = buildWeeklyDigest(report, {
      periodLabel: "Jun 8 to Jun 14",
      dashboardUrl: "https://app.example/reports",
    });
    const text = renderWeeklyDigestText(digest);

    expect(digest.subject).toContain("7 receipted bookings");
    expect(text).toContain("75%"); // held rate 9/12
    expect(text).toContain("80%"); // consent completeness 16/20
    expect(text).toContain("https://app.example/reports");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });
});
