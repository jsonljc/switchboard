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
    replyTimeStats: vi.fn().mockResolvedValue({ medianSeconds: 0, sampleSize: 0 }),
    alexStatsToday: vi
      .fn()
      .mockResolvedValue({ repliedToday: 0, qualifiedToday: 0, bookedToday: 0 }),
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
    expect(result.agentsToday.alex).toEqual({ repliedToday: 0, qualifiedToday: 0, bookedToday: 0 });
    expect(result.agentsToday.nova).toBeNull();
    expect(result.agentsToday.mira).toBeNull();
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

  it("populates today.revenue from sumRevenue with today's window + 7-day baseline for delta", async () => {
    const sumRevenue = vi.fn(async (_org: string, range: { from: Date; to: Date }) => {
      const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);
      // 7-day window → $700; today window (1 day) → $140
      if (days >= 6) return { totalAmount: 700, count: 14 };
      return { totalAmount: 140, count: 2 };
    });
    const result = await buildDashboardOverview("org-1", makeStores({ sumRevenue }), "USD");
    expect(result.today.revenue.amount).toBe(140);
    // 7-day daily avg = 100; today is 140 → +40%
    expect(result.today.revenue.deltaPctVsAvg).toBeCloseTo(0.4, 2);
  });

  it("today.revenue.deltaPctVsAvg is null when 7-day baseline is zero", async () => {
    const sumRevenue = vi.fn(async () => ({ totalAmount: 0, count: 0 }));
    const result = await buildDashboardOverview("org-1", makeStores({ sumRevenue }), "USD");
    expect(result.today.revenue.deltaPctVsAvg).toBeNull();
  });

  it("populates today.replyTime from replyTimeStats (today + yesterday for previousSeconds)", async () => {
    const replyTimeStats = vi.fn().mockImplementation(async (_org: string, day: Date) => {
      const isToday = day.toDateString() === new Date().toDateString();
      return isToday ? { medianSeconds: 12, sampleSize: 7 } : { medianSeconds: 18, sampleSize: 5 };
    });
    const result = await buildDashboardOverview("org-1", makeStores({ replyTimeStats }), "USD");
    expect(result.today.replyTime).toEqual({
      medianSeconds: 12,
      previousSeconds: 18,
      sampleSize: 7,
    });
  });

  it("today.replyTime is null when sampleSize=0 today", async () => {
    const replyTimeStats = vi.fn().mockResolvedValue({ medianSeconds: 0, sampleSize: 0 });
    const result = await buildDashboardOverview("org-1", makeStores({ replyTimeStats }), "USD");
    expect(result.today.replyTime).toBeNull();
  });

  it("today.replyTime is null when sampleSize < MIN_REPLY_SAMPLE (=3) — guards against single-reply skew", async () => {
    const replyTimeStats = vi.fn().mockResolvedValue({ medianSeconds: 5, sampleSize: 2 });
    const result = await buildDashboardOverview("org-1", makeStores({ replyTimeStats }), "USD");
    expect(result.today.replyTime).toBeNull();
  });

  it("populates agentsToday.alex from alexStatsToday", async () => {
    const alexStatsToday = vi
      .fn()
      .mockResolvedValue({ repliedToday: 14, qualifiedToday: 6, bookedToday: 3 });
    const result = await buildDashboardOverview("org-1", makeStores({ alexStatsToday }), "USD");
    expect(result.agentsToday.alex).toEqual({
      repliedToday: 14,
      qualifiedToday: 6,
      bookedToday: 3,
    });
  });
});
