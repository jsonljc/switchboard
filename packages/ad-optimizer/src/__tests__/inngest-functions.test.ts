// packages/ad-optimizer/src/__tests__/inngest-functions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeWeeklyAudit,
  executeDailyCheck,
  executeDailySignalHealthCheck,
  createWeeklyAuditDispatcher,
  createDailyCheckDispatcher,
  createWeeklyAuditCron,
  createDailyCheckCron,
  createDailySignalHealthCron,
  createRileyOutcomeAttributionDispatch,
  executeRileyOutcomeAttributionDispatch,
  type CronDependencies,
  type SignalHealthCronDependencies,
  type RileyOutcomeAttributionDispatchDeps,
} from "../inngest-functions.js";
import type { SignalHealthReport } from "../signal-health-checker.js";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({
    createFunction: createFunctionSpy,
  })),
}));

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

  it("threads signal-health deps into the runner when configured", async () => {
    const getReport = vi.fn().mockResolvedValue({
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
    });
    deps.getDeploymentPixelId = vi.fn().mockResolvedValue("px_1");
    deps.createSignalHealthChecker = vi.fn().mockReturnValue({ getSignalHealthReport: getReport });

    await executeWeeklyAudit(step as never, deps);

    // 2 deployments × 1 pixel lookup + 1 checker per deployment
    expect(deps.getDeploymentPixelId).toHaveBeenCalledTimes(2);
    expect(deps.createSignalHealthChecker).toHaveBeenCalledTimes(2);
    // The checker should have been invoked once per deployment (proves the
    // AuditRunner actually consumed the optional dep, not just constructed it).
    expect(getReport).toHaveBeenCalledTimes(2);
    expect(getReport).toHaveBeenCalledWith("px_1");
  });

  it("skips signal-health pre-check when pixelId lookup returns null", async () => {
    const getReport = vi.fn();
    deps.getDeploymentPixelId = vi.fn().mockResolvedValue(null);
    deps.createSignalHealthChecker = vi.fn().mockReturnValue({ getSignalHealthReport: getReport });

    await executeWeeklyAudit(step as never, deps);

    // Pixel-id lookup happens, but no checker is built and no report fetched.
    expect(deps.getDeploymentPixelId).toHaveBeenCalledTimes(2);
    expect(deps.createSignalHealthChecker).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
    // Audits still run normally for both deployments.
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(2);
  });

  it("threads recommendationEmitter into the AuditRunner when configured", async () => {
    const emitter = vi.fn().mockResolvedValue({ surface: "queue" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.recommendationEmitter = emitter;

    await executeWeeklyAudit(step as never, deps);

    // The audit-runner only logs `[ad-optimizer] Riley reviewed N candidates` when
    // its recommendationEmitter dep is set (it's the bottom of the
    // runRecommendationSink branch). The default mocks produce 0 candidates so the
    // emitter spy itself is never called, but the log line firing proves
    // executeWeeklyAudit threaded the emitter through to the AuditRunner constructor.
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("Riley reviewed"))).toBe(
      true,
    );

    warnSpy.mockRestore();
  });

  it("does NOT invoke the recommendation-sink branch when emitter is absent (back-compat)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // deps.recommendationEmitter is undefined by construction in beforeEach.

    await executeWeeklyAudit(step as never, deps);

    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("Riley reviewed"))).toBe(
      false,
    );

    warnSpy.mockRestore();
  });

  it("AuditRunner construction throws when emitter is provided without context", async () => {
    // Bypass executeWeeklyAudit (which always provides ctx alongside the
    // emitter) and test the runner's invariant directly. This pins the safety
    // net the constructor enforces: misconfiguration surfaces loudly, not
    // silently as orphan WorkTrace rows.
    const { AuditRunner } = await import("../audit-runner.js");
    const adsClient = deps.createAdsClient({ accessToken: "token", accountId: "act_123" });
    expect(
      () =>
        new AuditRunner({
          adsClient,
          crmDataProvider: deps.createCrmProvider("dep-1"),
          insightsProvider: deps.createInsightsProvider(adsClient),
          config: {
            accountId: "act_123",
            orgId: "org-1",
            targetCPA: 100,
            targetROAS: 3,
            mediaBenchmarks: {
              inlineLinkClickCtr: 2.0,
              landingPageViewRate: 0.85,
              clickToLeadRate: 0.05,
            },
          },
          recommendationEmitter: vi.fn().mockResolvedValue({ surface: "queue" }),
          // recommendationEmissionContext intentionally omitted — should throw.
        }),
    ).toThrow(/recommendationEmissionContext is required/);
  });

  it("wires real account ad-set attribution into the runner when the ads client supports it", async () => {
    const getAccountAdSetLearningInputs = vi.fn().mockResolvedValue([]);
    deps.createAdsClient = vi.fn().mockReturnValue({
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
      getAccountAdSetLearningInputs,
    });

    await executeWeeklyAudit(step as never, deps);

    // The runner invokes the wired getAdSetInsights callback, which calls through to the
    // account-level fetch — proving the cron threaded it (once per deployment).
    expect(getAccountAdSetLearningInputs).toHaveBeenCalledTimes(2);
  });

  it("degrades to no-attribution (does not throw, audit still saved) when the ad-set fetch fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getAccountAdSetLearningInputs = vi.fn().mockRejectedValue(new Error("Graph 500"));
    deps.createAdsClient = vi.fn().mockReturnValue({
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
      getAccountAdSetLearningInputs,
    });

    // The audit must complete for BOTH deployments despite the fetch error (honest abstain,
    // never a crashed weekly run).
    await expect(executeWeeklyAudit(step as never, deps)).resolves.toBeUndefined();
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
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

describe("executeDailySignalHealthCheck", () => {
  let deps: SignalHealthCronDependencies;
  let step: ReturnType<typeof makeMockStep>;
  let getReport: ReturnType<typeof vi.fn>;

  function makeReport(): SignalHealthReport {
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
      breaches: [
        {
          signal: "server_to_browser_low",
          severity: "warning",
          message: "Ratio 85% (target >90%).",
        },
      ],
    };
  }

  beforeEach(() => {
    step = makeMockStep();
    getReport = vi.fn().mockResolvedValue(makeReport());
    deps = {
      listActiveDeployments: vi.fn().mockResolvedValue([
        { id: "dep-1", organizationId: "org-1", inputConfig: {} },
        { id: "dep-2", organizationId: "org-2", inputConfig: {} },
      ]),
      getDeploymentCredentials: vi
        .fn()
        .mockResolvedValue({ accessToken: "tok", accountId: "act_1" }),
      getDeploymentPixelId: vi.fn().mockResolvedValue("px_1"),
      createSignalHealthChecker: vi.fn().mockReturnValue({
        getSignalHealthReport: getReport,
      }),
      saveSignalHealthReport: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("runs signal-health check for each deployment with credentials and a pixel", async () => {
    await executeDailySignalHealthCheck(step as never, deps);

    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.getDeploymentCredentials).toHaveBeenCalledTimes(2);
    expect(deps.getDeploymentPixelId).toHaveBeenCalledTimes(2);
    expect(deps.createSignalHealthChecker).toHaveBeenCalledTimes(2);
    expect(getReport).toHaveBeenCalledTimes(2);
    expect(getReport).toHaveBeenCalledWith("px_1");
    expect(deps.saveSignalHealthReport).toHaveBeenCalledTimes(2);
    expect(deps.saveSignalHealthReport).toHaveBeenCalledWith("dep-1", expect.any(Object));
  });

  it("skips deployments missing credentials", async () => {
    deps.getDeploymentCredentials = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "tok", accountId: "act_1" })
      .mockResolvedValueOnce(null);

    await executeDailySignalHealthCheck(step as never, deps);

    expect(deps.createSignalHealthChecker).toHaveBeenCalledTimes(1);
    expect(deps.saveSignalHealthReport).toHaveBeenCalledTimes(1);
  });

  it("skips deployments without a configured pixelId", async () => {
    deps.getDeploymentPixelId = vi.fn().mockResolvedValueOnce("px_1").mockResolvedValueOnce(null);

    await executeDailySignalHealthCheck(step as never, deps);

    expect(getReport).toHaveBeenCalledTimes(1);
    expect(deps.saveSignalHealthReport).toHaveBeenCalledTimes(1);
  });

  it("logs a warning when score is red but does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getReport.mockResolvedValue({
      ...makeReport(),
      score: "red",
      breaches: [{ signal: "pixel_dead", severity: "critical", message: "Dead." }],
    });

    await executeDailySignalHealthCheck(step as never, deps);

    expect(warnSpy).toHaveBeenCalled();
    const allWarnText = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWarnText).toMatch(/signal-health/i);
    warnSpy.mockRestore();
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

describe("executeRileyOutcomeAttributionDispatch", () => {
  function makeRileyStep() {
    return {
      run: vi.fn((_name: string, fn: () => unknown) => fn()),
    };
  }

  it("emits one riley.outcome.attribute event per Riley-active org", async () => {
    const step = makeRileyStep();
    const sendEvent = vi.fn().mockResolvedValue(undefined);
    const deps: RileyOutcomeAttributionDispatchDeps = {
      listRileyOrgs: vi.fn().mockResolvedValue(["org-1", "org-2"]),
      sendEvent,
    };

    const result = await executeRileyOutcomeAttributionDispatch(step as never, deps);

    expect(deps.listRileyOrgs).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent).toHaveBeenNthCalledWith(1, {
      name: "riley.outcome.attribute",
      data: { orgId: "org-1" },
    });
    expect(sendEvent).toHaveBeenNthCalledWith(2, {
      name: "riley.outcome.attribute",
      data: { orgId: "org-2" },
    });
    expect(result).toEqual({ dispatched: 2 });
  });

  it("returns dispatched: 0 when there are no Riley-active orgs", async () => {
    const step = makeRileyStep();
    const sendEvent = vi.fn().mockResolvedValue(undefined);
    const deps: RileyOutcomeAttributionDispatchDeps = {
      listRileyOrgs: vi.fn().mockResolvedValue([]),
      sendEvent,
    };

    const result = await executeRileyOutcomeAttributionDispatch(step as never, deps);

    expect(sendEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ dispatched: 0 });
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createWeeklyAuditCron + createDailySignalHealthCron (Class B)
// ---------------------------------------------------------------------------

function makeMinimalCronDeps(): CronDependencies {
  return {
    listActiveDeployments: vi.fn().mockResolvedValue([]),
    getDeploymentCredentials: vi.fn().mockResolvedValue(null),
    createAdsClient: vi.fn(),
    createCrmProvider: vi.fn(),
    createInsightsProvider: vi.fn(),
    saveAuditReport: vi.fn(),
  };
}

function makeMinimalSignalHealthDeps(): SignalHealthCronDependencies {
  return {
    listActiveDeployments: vi.fn().mockResolvedValue([]),
    getDeploymentCredentials: vi.fn().mockResolvedValue(null),
    getDeploymentPixelId: vi.fn().mockResolvedValue(null),
    createSignalHealthChecker: vi.fn(),
    saveSignalHealthReport: vi.fn(),
  };
}

describe("createWeeklyAuditCron — onFailure wiring", () => {
  it("passes onFailure into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createWeeklyAuditCron(makeMinimalCronDeps(), onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createWeeklyAuditCron(makeMinimalCronDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });
});

describe("createDailySignalHealthCron — onFailure wiring", () => {
  it("passes onFailure into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createDailySignalHealthCron(makeMinimalSignalHealthDeps(), onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createDailySignalHealthCron(makeMinimalSignalHealthDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createRileyOutcomeAttributionDispatch (Class C)
// ---------------------------------------------------------------------------

function makeMinimalRileyDispatchDeps(): RileyOutcomeAttributionDispatchDeps {
  return {
    listRileyOrgs: vi.fn().mockResolvedValue([]),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createRileyOutcomeAttributionDispatch — onFailure wiring", () => {
  it("passes onFailure into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createRileyOutcomeAttributionDispatch(makeMinimalRileyDispatchDeps(), onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createRileyOutcomeAttributionDispatch(makeMinimalRileyDispatchDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createDailyCheckCron (Class E)
// ---------------------------------------------------------------------------

describe("createDailyCheckCron — onFailure wiring", () => {
  it("passes onFailure into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createDailyCheckCron(makeMinimalCronDeps(), onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createDailyCheckCron(makeMinimalCronDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });
});
