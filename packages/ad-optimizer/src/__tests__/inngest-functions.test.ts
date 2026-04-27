// packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeWeeklyAudit,
  executeDailyCheck,
  createWeeklyAuditDispatcher,
  createDailyCheckDispatcher,
  type CronDependencies,
} from "../inngest-functions.js";

function makeMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  };
}

describe("executeWeeklyAudit", () => {
  let deps: CronDependencies;
  let step: ReturnType<typeof makeMockStep>;

  beforeEach(() => {
    step = makeMockStep();
    deps = {
      listActiveDeployments: vi.fn().mockResolvedValue([
        {
          id: "dep-1",
          organizationId: "org-1",
          inputConfig: { monthlyBudget: 1000, targetCPA: 100, targetROAS: 3.0 },
        },
        {
          id: "dep-2",
          organizationId: "org-2",
          inputConfig: { monthlyBudget: 500, targetCPA: 50, targetROAS: 2.0 },
        },
      ]),
      createAdsClient: vi.fn().mockReturnValue({
        getCampaignInsights: vi.fn().mockResolvedValue([]),
        getAdSetInsights: vi.fn().mockResolvedValue([]),
        getAccountSummary: vi.fn().mockResolvedValue({
          accountId: "act_123",
          accountName: "Test",
          currency: "USD",
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          activeCampaigns: 0,
        }),
      }),
      createCrmProvider: vi.fn().mockReturnValue({
        getFunnelData: vi.fn().mockResolvedValue({
          campaignIds: [],
          leads: 0,
          qualified: 0,
          opportunities: 0,
          bookings: 0,
          closed: 0,
          revenue: 0,
          rates: {
            leadToQualified: 0,
            qualifiedToBooking: 0,
            bookingToClosed: 0,
            leadToClosed: 0,
          },
          coverage: {
            attributedContacts: 0,
            contactsWithEmailOrPhone: 0,
            contactsWithOpportunity: 0,
            contactsWithBooking: 0,
            contactsWithRevenueEvent: 0,
          },
        }),
        getBenchmarks: vi.fn().mockResolvedValue({
          leadToQualifiedRate: 0.4,
          qualifiedToBookingRate: 0.5,
          bookingToClosedRate: 0.25,
          leadToClosedRate: 0.06,
        }),
      }),
      createInsightsProvider: vi.fn().mockReturnValue({
        getCampaignLearningData: vi.fn().mockResolvedValue({
          effectiveStatus: "ACTIVE",
          learningPhase: false,
          lastModifiedDays: 14,
          optimizationEvents: 100,
        }),
        getTargetBreachStatus: vi.fn().mockResolvedValue({
          periodsAboveTarget: 0,
          granularity: "daily",
          isApproximate: false,
        }),
      }),
      saveAuditReport: vi.fn().mockResolvedValue(undefined),
      getDeploymentCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        accountId: "act_123",
      }),
    };
  });

  it("runs audit for each active deployment", async () => {
    await executeWeeklyAudit(step as never, deps);
    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.createAdsClient).toHaveBeenCalledTimes(2);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(2);
  });

  it("skips deployment when credentials are missing", async () => {
    deps.getDeploymentCredentials = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token", accountId: "act_123" })
      .mockResolvedValueOnce(null);
    await executeWeeklyAudit(step as never, deps);
    expect(deps.createAdsClient).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
  });
});

describe("executeDailyCheck", () => {
  let deps: CronDependencies;
  let step: ReturnType<typeof makeMockStep>;

  beforeEach(() => {
    step = makeMockStep();
    deps = {
      listActiveDeployments: vi.fn().mockResolvedValue([
        {
          id: "dep-1",
          organizationId: "org-1",
          inputConfig: { monthlyBudget: 1000, targetCPA: 100, targetROAS: 3.0 },
        },
      ]),
      createAdsClient: vi.fn().mockReturnValue({
        getAccountSummary: vi.fn().mockResolvedValue({
          accountId: "act_123",
          accountName: "Test",
          currency: "USD",
          totalSpend: 500,
          totalImpressions: 50000,
          totalClicks: 2000,
          activeCampaigns: 3,
        }),
      }),
      createCrmProvider: vi.fn(),
      createInsightsProvider: vi.fn(),
      saveAuditReport: vi.fn(),
      getDeploymentCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        accountId: "act_123",
      }),
    };
  });

  it("checks account summary for each deployment", async () => {
    await executeDailyCheck(step as never, deps);
    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.getDeploymentCredentials).toHaveBeenCalledTimes(1);
  });
});

describe("createWeeklyAuditDispatcher", () => {
  it("dispatches one event per deployment", async () => {
    const events: Array<{ name: string; data: unknown }> = [];
    const mockStep = {
      run: vi.fn().mockImplementation((_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn().mockImplementation((_id: string, event: unknown) => {
        events.push(event as { name: string; data: unknown });
      }),
    };
    const mockInngest = {
      createFunction: vi.fn().mockImplementation((_config: unknown, handler: unknown) => handler),
    };
    const deps = {
      listActiveDeployments: vi.fn().mockResolvedValue([{ id: "d1" }, { id: "d2" }]),
    };

    const handler = createWeeklyAuditDispatcher(mockInngest, deps);
    await (handler as unknown as (ctx: { step: unknown }) => Promise<void>)({ step: mockStep });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      name: "skill-runtime/batch.requested",
      data: {
        deploymentId: "d1",
        skillSlug: "ad-optimizer",
        trigger: "weekly_audit",
        scheduleName: "ad-optimizer-weekly",
      },
    });
  });
});

describe("createDailyCheckDispatcher", () => {
  it("dispatches one event per deployment with daily_check trigger", async () => {
    const events: Array<{ name: string; data: unknown }> = [];
    const mockStep = {
      run: vi.fn().mockImplementation((_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn().mockImplementation((_id: string, event: unknown) => {
        events.push(event as { name: string; data: unknown });
      }),
    };
    const mockInngest = {
      createFunction: vi.fn().mockImplementation((_config: unknown, handler: unknown) => handler),
    };
    const deps = {
      listActiveDeployments: vi.fn().mockResolvedValue([{ id: "d1" }]),
    };

    const handler = createDailyCheckDispatcher(mockInngest, deps);
    await (handler as unknown as (ctx: { step: unknown }) => Promise<void>)({ step: mockStep });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        name: "skill-runtime/batch.requested",
        data: expect.objectContaining({ trigger: "daily_check" }),
      }),
    );
  });
});
