// packages/ad-optimizer/src/__tests__/inngest-functions-config-coercion.test.ts
// A21 (P1-9): the marketplace listing form stores numeric config as `type:"text"`,
// so a real org's inputConfig carries STRINGS even though DeploymentInfo.inputConfig
// types them as numbers. The weekly-audit cron must coerce them (a string reaches
// budget-analyzer where `targetCPA.toFixed(2)` throws), and fail CLOSED on malformed
// numbers rather than NaN-suppressing every breach/pause rec. Split into its own file
// because inngest-functions.test.ts sits at the 600-line eslint max-lines cap.
import { describe, it, expect, vi } from "vitest";
import { executeWeeklyAudit, type CronDependencies } from "../inngest-functions.js";

type StepRun = <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;

function makeTypedStep(): { run: ReturnType<typeof vi.fn> & StepRun } {
  const run = vi.fn(async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => fn());
  return { run: run as ReturnType<typeof vi.fn> & StepRun };
}

function workingAdsClient() {
  return {
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
    listActiveDeployments: vi.fn().mockResolvedValue([]),
    createAdsClient: vi.fn().mockReturnValue(workingAdsClient()),
    createCrmProvider: vi.fn().mockReturnValue(baseCrmProvider()),
    createInsightsProvider: vi.fn().mockReturnValue(baseInsightsProvider()),
    saveAuditReport: vi.fn().mockResolvedValue(undefined),
    getDeploymentCredentials: vi.fn().mockResolvedValue({ accessToken: "tok", accountId: "act_1" }),
  };
}

describe("executeWeeklyAudit — numeric config coercion (A21)", () => {
  it("completes the audit when numeric config arrives as operator strings", async () => {
    const step = makeTypedStep();
    const deps: CronDependencies = {
      ...baseWeeklyDeps(),
      // Strings, exactly as seed-marketplace.ts stores them (`type:"text"` form).
      listActiveDeployments: vi.fn().mockResolvedValue([
        {
          id: "dep-str",
          organizationId: "org-str",
          inputConfig: { monthlyBudget: "3000", targetCPA: "30", targetROAS: "2.5" } as never,
        },
      ]),
    };

    await executeWeeklyAudit(step as never, deps);

    // The string config did not crash the audit: it ran and saved a report.
    expect(deps.createAdsClient).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledWith("dep-str", expect.any(Object));
  });

  it("skips + surfaces a deployment with malformed numeric config, fleet continues", async () => {
    const onDeploymentFailure = vi.fn().mockResolvedValue(undefined);
    const step = makeTypedStep();
    const deps: CronDependencies = {
      ...baseWeeklyDeps(),
      onDeploymentFailure,
      listActiveDeployments: vi.fn().mockResolvedValue([
        {
          id: "dep-bad",
          organizationId: "org-bad",
          inputConfig: { targetCPA: "$1,500" } as never,
        },
        {
          id: "dep-ok",
          organizationId: "org-ok",
          inputConfig: { targetCPA: "30" } as never,
        },
      ]),
    };

    await executeWeeklyAudit(step as never, deps);

    // The malformed org is skipped BEFORE its audit step (fail-closed), surfaced via the
    // same per-deployment alert wire; the healthy org still runs (no fleet starvation).
    expect(onDeploymentFailure).toHaveBeenCalledTimes(1);
    expect(onDeploymentFailure).toHaveBeenCalledWith(
      { deploymentId: "dep-bad", organizationId: "org-bad" },
      expect.anything(),
    );
    expect(deps.createAdsClient).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledWith("dep-ok", expect.any(Object));
  });
});
