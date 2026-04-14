// packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeWeeklyAudit,
  executeDailyCheck,
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
          inputConfig: { monthlyBudget: 1000, targetCPA: 100, targetROAS: 3.0 },
        },
        {
          id: "dep-2",
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
        getFunnelData: vi.fn().mockResolvedValue({ leads: 0, qualified: 0, closed: 0, revenue: 0 }),
        getBenchmarks: vi.fn().mockResolvedValue({
          ctr: 2.5,
          landingPageViewRate: 0.8,
          leadRate: 0.04,
          qualificationRate: 0.4,
          closeRate: 0.3,
        }),
        getCampaignLearningData: vi.fn().mockResolvedValue({
          effectiveStatus: "ACTIVE",
          learningPhase: false,
          lastModifiedDays: 14,
          optimizationEvents: 100,
        }),
        getDaysAboveTarget: vi.fn().mockResolvedValue(0),
      }),
      saveAuditReport: vi.fn().mockResolvedValue(undefined),
      getDeploymentCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        accountId: "act_123",
      }),
    };
  });

  it("runs audit for each active deployment", async () => {
    await executeWeeklyAudit(step, deps);
    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.createAdsClient).toHaveBeenCalledTimes(2);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(2);
  });

  it("skips deployment when credentials are missing", async () => {
    deps.getDeploymentCredentials = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token", accountId: "act_123" })
      .mockResolvedValueOnce(null);
    await executeWeeklyAudit(step, deps);
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
      saveAuditReport: vi.fn(),
      getDeploymentCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        accountId: "act_123",
      }),
    };
  });

  it("checks account summary for each deployment", async () => {
    await executeDailyCheck(step, deps);
    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.getDeploymentCredentials).toHaveBeenCalledTimes(1);
  });
});
