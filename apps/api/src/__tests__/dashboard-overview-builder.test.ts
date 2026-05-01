import { describe, it, expect, vi } from "vitest";
import { buildDashboardOverview, type DashboardStores } from "../routes/dashboard-overview.js";

function makeStores(overrides: Partial<DashboardStores> = {}): DashboardStores {
  return {
    listBookingsByDate: vi.fn().mockResolvedValue([]),
    listOpenTasks: vi.fn().mockResolvedValue(Object.assign([], { openCount: 0, overdueCount: 0 })),
    activePipelineCounts: vi.fn().mockResolvedValue({
      inquiry: 0,
      qualified: 0,
      booked: 0,
      purchased: 0,
      completed: 0,
    }),
    sumRevenue: vi.fn().mockResolvedValue({ totalAmount: 0, count: 0 }),
    sumRevenueByCampaign: vi.fn().mockResolvedValue([]),
    countByType: vi.fn().mockResolvedValue(0),
    queryApprovals: vi.fn().mockResolvedValue([]),
    queryAudit: vi.fn().mockResolvedValue([]),
    queryOperatorName: vi.fn().mockResolvedValue("Jane"),
    ...overrides,
  };
}

describe("buildDashboardOverview (option C1 shape)", () => {
  it("returns the new namespaced shape for an empty org", async () => {
    const result = await buildDashboardOverview("org-1", makeStores(), "USD");
    expect(result.today.revenue).toEqual({ amount: 0, currency: "USD", deltaPctVsAvg: null });
    expect(result.today.spend).toEqual({
      amount: 0,
      currency: "USD",
      capPct: 0,
      updatedAt: null,
    });
    expect(result.today.replyTime).toBeNull();
    expect(result.today.leads).toEqual({ count: 0, yesterdayCount: 0 });
    expect(result.today.appointments).toEqual({ count: 0, next: null });
    expect(result.agentsToday).toEqual({ alex: null, nova: null, mira: null });
    expect(result.novaAdSets).toEqual([]);
    expect(result.activity).toEqual([]);
  });

  it("populates today.leads from countByType results", async () => {
    const countByType = vi.fn().mockImplementation((_org: string, _type: string, from: Date) => {
      const d = from.getDate();
      // distinguish today (most recent) vs yesterday by day-of-month
      return Promise.resolve(d === new Date().getDate() ? 7 : 5);
    });
    const result = await buildDashboardOverview("org-1", makeStores({ countByType }), "USD");
    expect(result.today.leads.count).toBe(7);
    expect(result.today.leads.yesterdayCount).toBe(5);
  });

  it("derives today.appointments.next from the first today-booking", async () => {
    const today = new Date();
    today.setHours(11, 0, 0, 0);
    const listBookingsByDate = vi.fn().mockResolvedValue([
      {
        id: "b-1",
        startsAt: today,
        service: "Consult",
        status: "confirmed",
        sourceChannel: "web",
        contact: { name: "Sarah" },
      },
    ]);
    const result = await buildDashboardOverview("org-1", makeStores({ listBookingsByDate }), "USD");
    expect(result.today.appointments.count).toBe(1);
    expect(result.today.appointments.next?.contactName).toBe("Sarah");
    expect(result.today.appointments.next?.service).toBe("Consult");
  });

  it("uses the orgCurrency arg for placeholder Tier B blocks", async () => {
    const result = await buildDashboardOverview("org-1", makeStores(), "EUR");
    expect(result.today.revenue.currency).toBe("EUR");
    expect(result.today.spend.currency).toBe("EUR");
  });
});
