import { describe, it, expect, vi } from "vitest";
import { PrismaCrmDataProvider, QUALIFIED_OR_LATER_STAGES } from "../prisma-crm-data-provider.js";

function makeMockPrisma(contacts: unknown[] = []) {
  return {
    contact: {
      findMany: vi.fn().mockResolvedValue(contacts),
      count: vi.fn().mockResolvedValue(contacts.length),
    },
  };
}

describe("PrismaCrmDataProvider", () => {
  describe("getBenchmarks", () => {
    it("returns hardcoded beauty/aesthetics defaults for v1", async () => {
      const prisma = makeMockPrisma();
      const provider = new PrismaCrmDataProvider(prisma as never);

      const benchmarks = await provider.getBenchmarks({
        orgId: "org_1",
        accountId: "act_1",
      });

      expect(benchmarks.leadToQualifiedRate).toBe(0.3);
      expect(benchmarks.qualifiedToBookingRate).toBe(0.4);
      expect(benchmarks.bookingToClosedRate).toBe(0.5);
      expect(benchmarks.leadToClosedRate).toBe(0.06);
    });
  });

  describe("getFunnelData", () => {
    it("returns zero counts when no contacts match", async () => {
      const prisma = makeMockPrisma([]);
      const provider = new PrismaCrmDataProvider(prisma as never);

      const data = await provider.getFunnelData({
        orgId: "org_1",
        accountId: "act_1",
        campaignIds: ["camp_1"],
        startDate: new Date("2026-04-01"),
        endDate: new Date("2026-04-30"),
      });

      expect(data.leads).toBe(0);
      expect(data.qualified).toBe(0);
      expect(data.bookings).toBe(0);
      expect(data.closed).toBe(0);
      expect(data.revenue).toBe(0);
      expect(data.rates.leadToQualified).toBeNull();
      expect(data.rates.leadToClosed).toBeNull();
    });

    it("counts contacts with matching campaign attribution", async () => {
      const contacts = [
        {
          id: "ct_1",
          email: "a@b.com",
          phone: "+1234",
          attribution: { sourceCampaignId: "camp_1" },
          opportunities: [{ stage: "qualified" }],
          revenueEvents: [{ status: "confirmed", amount: 500 }],
        },
        {
          id: "ct_2",
          email: null,
          phone: null,
          attribution: { sourceCampaignId: "camp_1" },
          opportunities: [],
          revenueEvents: [],
        },
        {
          id: "ct_3",
          email: "c@d.com",
          phone: null,
          attribution: { sourceCampaignId: "camp_other" },
          opportunities: [],
          revenueEvents: [],
        },
      ];

      const prisma = makeMockPrisma(contacts);
      const provider = new PrismaCrmDataProvider(prisma as never);

      const data = await provider.getFunnelData({
        orgId: "org_1",
        accountId: "act_1",
        campaignIds: ["camp_1"],
        startDate: new Date("2026-04-01"),
        endDate: new Date("2026-04-30"),
      });

      expect(data.leads).toBe(2);
      expect(data.qualified).toBe(1);
      expect(data.closed).toBe(1);
      expect(data.revenue).toBe(500);
      expect(data.coverage.attributedContacts).toBe(2);
      expect(data.coverage.contactsWithEmailOrPhone).toBe(1);
      expect(data.coverage.contactsWithOpportunity).toBe(1);
      expect(data.coverage.contactsWithRevenueEvent).toBe(1);
    });
  });

  describe("QUALIFIED_OR_LATER_STAGES", () => {
    it("includes expected stages", () => {
      expect(QUALIFIED_OR_LATER_STAGES).toContain("qualified");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("booked");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("won");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("closed");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("completed");
    });
  });
});
