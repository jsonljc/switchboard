import { describe, it, expect, beforeEach } from "vitest";
import { OutcomeTracker } from "../outcome-tracker.js";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    type: "inquiry",
    contactId: "ct_1",
    organizationId: "org_dental",
    value: 0,
    sourceAdId: "ad_whitening",
    sourceCampaignId: "camp_spring",
    timestamp: new Date("2026-03-05T10:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

describe("OutcomeTracker", () => {
  let tracker: OutcomeTracker;
  const since = new Date("2026-03-01T00:00:00Z");
  const until = new Date("2026-03-08T23:59:59Z");

  beforeEach(() => {
    tracker = new OutcomeTracker();
  });

  describe("record and computeMetrics", () => {
    it("computes cost per inquiry correctly", () => {
      tracker.record(makeEvent({ type: "inquiry", contactId: "ct_1" }));
      tracker.record(makeEvent({ type: "inquiry", contactId: "ct_2" }));
      tracker.record(makeEvent({ type: "inquiry", contactId: "ct_3" }));

      const metrics = tracker.computeMetrics("org_dental", 150, since, until);

      expect(metrics.inquiries).toBe(3);
      expect(metrics.costPerInquiry).toBe(50); // $150 / 3
    });

    it("computes cost per qualified lead", () => {
      tracker.record(makeEvent({ type: "inquiry", contactId: "ct_1" }));
      tracker.record(makeEvent({ type: "qualified", contactId: "ct_1" }));
      tracker.record(makeEvent({ type: "inquiry", contactId: "ct_2" }));
      tracker.record(makeEvent({ type: "qualified", contactId: "ct_2" }));

      const metrics = tracker.computeMetrics("org_dental", 200, since, until);

      expect(metrics.qualifiedLeads).toBe(2);
      expect(metrics.costPerQualifiedLead).toBe(100); // $200 / 2
    });

    it("computes cost per booking", () => {
      tracker.record(makeEvent({ type: "booked", contactId: "ct_1", value: 250 }));
      tracker.record(makeEvent({ type: "booked", contactId: "ct_2", value: 300 }));

      const metrics = tracker.computeMetrics("org_dental", 100, since, until);

      expect(metrics.bookings).toBe(2);
      expect(metrics.costPerBooking).toBe(50); // $100 / 2
    });

    it("computes ROAS (revenue per ad dollar)", () => {
      tracker.record(makeEvent({ type: "purchased", contactId: "ct_1", value: 500 }));
      tracker.record(makeEvent({ type: "completed", contactId: "ct_2", value: 300 }));

      const metrics = tracker.computeMetrics("org_dental", 200, since, until);

      expect(metrics.totalRevenue).toBe(800);
      expect(metrics.roas).toBe(4); // $800 / $200 = 4x
    });

    it("returns null for metrics with zero denominators", () => {
      const metrics = tracker.computeMetrics("org_dental", 100, since, until);

      expect(metrics.costPerInquiry).toBeNull();
      expect(metrics.costPerQualifiedLead).toBeNull();
      expect(metrics.costPerBooking).toBeNull();
      expect(metrics.costPerPurchase).toBeNull();
    });

    it("returns null ROAS when spend is zero", () => {
      tracker.record(makeEvent({ type: "purchased", value: 500 }));

      const metrics = tracker.computeMetrics("org_dental", 0, since, until);

      expect(metrics.roas).toBeNull();
    });

    it("filters by organization", () => {
      tracker.record(makeEvent({ type: "inquiry", organizationId: "org_dental" }));
      tracker.record(makeEvent({ type: "inquiry", organizationId: "org_other" }));

      const metrics = tracker.computeMetrics("org_dental", 100, since, until);

      expect(metrics.inquiries).toBe(1);
    });

    it("filters by date range", () => {
      tracker.record(
        makeEvent({
          type: "inquiry",
          timestamp: new Date("2026-02-28T23:59:59Z"), // Before range
        }),
      );
      tracker.record(
        makeEvent({
          type: "inquiry",
          timestamp: new Date("2026-03-05T12:00:00Z"), // In range
        }),
      );
      tracker.record(
        makeEvent({
          type: "inquiry",
          timestamp: new Date("2026-03-09T00:00:01Z"), // After range
        }),
      );

      const metrics = tracker.computeMetrics("org_dental", 100, since, until);

      expect(metrics.inquiries).toBe(1);
    });

    it("only counts conversions from ads (with sourceAdId)", () => {
      tracker.record(makeEvent({ type: "inquiry", sourceAdId: "ad_1" }));
      tracker.record(makeEvent({ type: "inquiry", sourceAdId: undefined })); // Organic

      const metrics = tracker.computeMetrics("org_dental", 100, since, until);

      expect(metrics.inquiries).toBe(1);
    });

    it("aggregates per-campaign breakdown", () => {
      tracker.record(makeEvent({ type: "inquiry", sourceCampaignId: "camp_a" }));
      tracker.record(makeEvent({ type: "inquiry", sourceCampaignId: "camp_a" }));
      tracker.record(makeEvent({ type: "booked", sourceCampaignId: "camp_a", value: 200 }));
      tracker.record(makeEvent({ type: "inquiry", sourceCampaignId: "camp_b" }));
      tracker.record(makeEvent({ type: "booked", sourceCampaignId: "camp_b", value: 300 }));

      const metrics = tracker.computeMetrics("org_dental", 500, since, until);

      expect(metrics.byCampaign).toHaveLength(2);

      const campA = metrics.byCampaign.find((c) => c.campaignId === "camp_a");
      expect(campA).toBeDefined();
      expect(campA!.inquiries).toBe(2);
      expect(campA!.bookings).toBe(1);
      expect(campA!.revenue).toBe(200);

      const campB = metrics.byCampaign.find((c) => c.campaignId === "camp_b");
      expect(campB).toBeDefined();
      expect(campB!.inquiries).toBe(1);
      expect(campB!.bookings).toBe(1);
      expect(campB!.revenue).toBe(300);
    });

    it("groups events without campaignId under 'unknown'", () => {
      tracker.record(makeEvent({ type: "inquiry", sourceCampaignId: undefined }));

      const metrics = tracker.computeMetrics("org_dental", 100, since, until);

      expect(metrics.byCampaign).toHaveLength(1);
      expect(metrics.byCampaign[0]!.campaignId).toBe("unknown");
    });
  });

  describe("register", () => {
    it("subscribes to conversion bus and records events", () => {
      const bus = new InMemoryConversionBus();
      tracker.register(bus);

      bus.emit(makeEvent({ type: "booked", value: 100 }));
      bus.emit(makeEvent({ type: "inquiry" }));

      expect(tracker.getConversionCount()).toBe(2);

      const metrics = tracker.computeMetrics("org_dental", 200, since, until);
      expect(metrics.bookings).toBe(1);
      expect(metrics.inquiries).toBe(1);
    });
  });

  describe("getConversionCount", () => {
    it("returns total count", () => {
      tracker.record(makeEvent());
      tracker.record(makeEvent());

      expect(tracker.getConversionCount()).toBe(2);
    });

    it("returns filtered count by organization", () => {
      tracker.record(makeEvent({ organizationId: "org_a" }));
      tracker.record(makeEvent({ organizationId: "org_b" }));
      tracker.record(makeEvent({ organizationId: "org_a" }));

      expect(tracker.getConversionCount("org_a")).toBe(2);
      expect(tracker.getConversionCount("org_b")).toBe(1);
    });
  });
});
