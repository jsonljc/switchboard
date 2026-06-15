// packages/ad-optimizer/src/__tests__/inngest-functions-isolation.test.ts
// PR 1.4a (D2-3 isolation half): one deployment's exhausted audit step must not
// abort the fleet. Split out of inngest-functions.test.ts (which is at the
// 600-line eslint max-lines cap) so the isolation pins live in their own file.
import { describe, it, expect, vi } from "vitest";
import {
  executeWeeklyAudit,
  executeDailySignalHealthCheck,
  type CronDependencies,
  type SignalHealthCronDependencies,
} from "../inngest-functions.js";
import type { SignalHealthReport } from "../signal-health-checker.js";

// Typed step spy: an untyped vi.fn() makes mock.calls an empty tuple under
// tsc-over-tests, which reds the api/chat BUILD (feedback_vitest_untyped_fn).
type StepRun = <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;

function makeTypedStep(): { run: ReturnType<typeof vi.fn> & StepRun } {
  const run = vi.fn(async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => fn());
  return { run: run as ReturnType<typeof vi.fn> & StepRun };
}

function emptyAccountSummary() {
  return {
    accountId: "act_123",
    accountName: "Test",
    currency: "USD",
    totalSpend: 0,
    totalImpressions: 0,
    totalClicks: 0,
    activeCampaigns: 0,
  };
}

function workingAdsClient() {
  return {
    getCampaignInsights: vi.fn().mockResolvedValue([]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(emptyAccountSummary()),
  };
}

function baseCrmProvider() {
  return {
    getFunnelData: vi.fn().mockResolvedValue({
      campaignIds: [],
      leads: 0,
      qualified: 0,
      opportunities: 0,
      bookings: 0,
      closed: 0,
      revenue: 0,
      rates: { leadToQualified: 0, qualifiedToBooking: 0, bookingToClosed: 0, leadToClosed: 0 },
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
  };
}

function baseInsightsProvider() {
  return {
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
  };
}

function baseWeeklyDeps(): CronDependencies {
  return {
    listActiveDeployments: vi.fn().mockResolvedValue([
      { id: "dep-1", organizationId: "org-1", inputConfig: { targetCPA: 100, targetROAS: 3.0 } },
      { id: "dep-2", organizationId: "org-2", inputConfig: { targetCPA: 50, targetROAS: 2.0 } },
    ]),
    createAdsClient: vi.fn().mockReturnValue(workingAdsClient()),
    createCrmProvider: vi.fn().mockReturnValue(baseCrmProvider()),
    createInsightsProvider: vi.fn().mockReturnValue(baseInsightsProvider()),
    saveAuditReport: vi.fn().mockResolvedValue(undefined),
    getDeploymentCredentials: vi.fn().mockResolvedValue({ accessToken: "tok", accountId: "act_1" }),
  };
}

describe("executeWeeklyAudit — per-deployment isolation (D2-3)", () => {
  it("continues the fleet when one deployment's audit throws, recording the failure", async () => {
    const onDeploymentFailure = vi.fn();
    const step = makeTypedStep();
    // dep-1's ads client throws while building/running the audit; dep-2 is healthy.
    const throwingClient = {
      getCampaignInsights: vi.fn().mockRejectedValue(new Error("Graph 500 for dep-1")),
      getAdSetInsights: vi.fn().mockResolvedValue([]),
      getAccountSummary: vi.fn().mockResolvedValue(emptyAccountSummary()),
      getAccountAdSetLearningInputs: vi.fn().mockRejectedValue(new Error("Graph 500 for dep-1")),
    };
    const deps: CronDependencies = {
      ...baseWeeklyDeps(),
      // dep-1's required campaign-insights fetch rejects (e.g. an exhausted 429),
      // so dep-1's audit step throws out of runner.run() before it can save.
      // dep-2 is healthy and must still produce + save its report.
      createAdsClient: vi
        .fn()
        .mockReturnValueOnce(throwingClient)
        .mockReturnValueOnce(workingAdsClient()),
      saveAuditReport: vi.fn().mockResolvedValue(undefined),
      onDeploymentFailure,
    };

    await expect(executeWeeklyAudit(step as never, deps)).resolves.toBeUndefined();

    // dep-1 threw before saving; dep-2 still produced + saved a report despite that.
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledWith("dep-2", expect.any(Object));
    // dep-1's failure was recorded, not swallowed silently.
    expect(onDeploymentFailure).toHaveBeenCalledTimes(1);
    expect(onDeploymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1", organizationId: "org-1" }),
      expect.any(Error),
    );
  });

  it("does not call onDeploymentFailure when every deployment audits cleanly", async () => {
    const onDeploymentFailure = vi.fn();
    const step = makeTypedStep();
    const deps: CronDependencies = { ...baseWeeklyDeps(), onDeploymentFailure };

    await executeWeeklyAudit(step as never, deps);

    expect(deps.saveAuditReport).toHaveBeenCalledTimes(2);
    expect(onDeploymentFailure).not.toHaveBeenCalled();
  });
});

function makeSignalReport(): SignalHealthReport {
  return {
    pixelId: "px_1",
    score: "yellow",
    pixelHealth: {
      pixelId: "px_1",
      name: "P",
      lastFiredAt: new Date().toISOString(),
      isUnavailable: false,
      automaticMatchingFields: ["em"],
      isDead: false,
    },
    eventVolume: { events: [] },
    capiHealth: {
      serverToBrowserRatio: 0.85,
      dedupRate: 0.6,
      lastServerEventAt: new Date().toISOString(),
      freshnessMs: 60_000,
      isFresh: true,
    },
    daChecks: { checks: [], hasFailure: false },
    emqProxy: 0.51,
    breaches: [{ signal: "server_to_browser_low", severity: "warning", message: "Ratio 85%." }],
  };
}

function baseSignalHealthDeps(): SignalHealthCronDependencies {
  return {
    listActiveDeployments: vi.fn().mockResolvedValue([
      { id: "dep-1", organizationId: "org-1", inputConfig: {} },
      { id: "dep-2", organizationId: "org-2", inputConfig: {} },
    ]),
    getDeploymentCredentials: vi.fn().mockResolvedValue({ accessToken: "tok", accountId: "act_1" }),
    getDeploymentPixelId: vi.fn().mockResolvedValue("px_1"),
    createSignalHealthChecker: vi
      .fn()
      .mockReturnValue({ getSignalHealthReport: vi.fn().mockResolvedValue(makeSignalReport()) }),
    saveSignalHealthReport: vi.fn().mockResolvedValue(undefined),
  };
}

describe("executeDailySignalHealthCheck — per-deployment isolation (D2-3)", () => {
  it("continues the fleet when one deployment's signal-health step throws, recording the failure", async () => {
    const onDeploymentFailure = vi.fn();
    const step = makeTypedStep();
    const deps: SignalHealthCronDependencies = {
      ...baseSignalHealthDeps(),
      saveSignalHealthReport: vi
        .fn()
        .mockRejectedValueOnce(new Error("save failed for dep-1"))
        .mockResolvedValueOnce(undefined),
      onDeploymentFailure,
    };

    await expect(executeDailySignalHealthCheck(step as never, deps)).resolves.toBeUndefined();

    // dep-2 still produced + saved a report despite dep-1 throwing.
    expect(deps.saveSignalHealthReport).toHaveBeenCalledTimes(2);
    expect(deps.saveSignalHealthReport).toHaveBeenLastCalledWith("dep-2", expect.any(Object));
    expect(onDeploymentFailure).toHaveBeenCalledTimes(1);
    expect(onDeploymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1", organizationId: "org-1" }),
      expect.any(Error),
    );
  });
});
