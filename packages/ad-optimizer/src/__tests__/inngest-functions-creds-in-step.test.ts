// packages/ad-optimizer/src/__tests__/inngest-functions-creds-in-step.test.ts
//
// PR 1.3 (D2-4): credentials must be resolved INSIDE the consuming Inngest step, never in a
// standalone `creds-${id}` step whose JSON-memoized output would serialize the cleartext access
// token into Inngest step state. Split out of inngest-functions.test.ts (the main file is near
// the eslint max-lines cap), mirroring the existing inngest-functions-handoff.test.ts sibling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeWeeklyAudit,
  executeDailyCheck,
  executeDailySignalHealthCheck,
  type CronDependencies,
  type SignalHealthCronDependencies,
} from "../inngest-functions.js";

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: vi.fn().mockReturnValue({}) })),
}));

// TYPED step.run spy capturing every step name. Untyped, `mock.calls` would be an empty-tuple
// type and red the api/chat BUILD under tsc-over-tests.
function makeMockStep(): { run: ReturnType<typeof vi.fn>; stepNames: string[] } {
  const stepNames: string[] = [];
  return {
    run: vi.fn((name: string, fn: () => unknown) => {
      stepNames.push(name);
      return fn();
    }),
    stepNames,
  };
}

// getDeploymentCredentials spy that records which step was active (last-pushed name) at each
// resolution, proving the token is read inside the consuming step, not a standalone `creds-` step.
function makeCredsProbe(step: { stepNames: string[] }) {
  const activeStepAtResolve: Array<string | undefined> = [];
  const spy = vi.fn(() => {
    activeStepAtResolve.push(step.stepNames[step.stepNames.length - 1]);
    return Promise.resolve({ accessToken: "token", accountId: "act_123" });
  });
  return { spy, activeStepAtResolve };
}

function expectCredsInStep(
  step: { stepNames: string[] },
  activeStepAtResolve: Array<string | undefined>,
  prefix: string,
  count: number,
) {
  expect(step.stepNames.some((n) => n.startsWith("creds-"))).toBe(false);
  expect(activeStepAtResolve).toHaveLength(count);
  for (const active of activeStepAtResolve) {
    expect(active).toMatch(new RegExp(`^${prefix}`));
  }
}

describe("D2-4: credentials resolved inside the consuming step", () => {
  describe("executeWeeklyAudit", () => {
    let deps: CronDependencies;
    let step: ReturnType<typeof makeMockStep>;

    beforeEach(() => {
      step = makeMockStep();
      deps = {
        listActiveDeployments: vi.fn().mockResolvedValue([
          { id: "dep-1", organizationId: "org-1", inputConfig: { targetCPA: 100, targetROAS: 3 } },
          { id: "dep-2", organizationId: "org-2", inputConfig: { targetCPA: 50, targetROAS: 2 } },
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
        getDeploymentCredentials: vi
          .fn()
          .mockResolvedValue({ accessToken: "token", accountId: "act_123" }),
      };
    });

    it("never names a `creds-` step; resolves creds inside each audit step", async () => {
      const { spy, activeStepAtResolve } = makeCredsProbe(step);
      deps.getDeploymentCredentials = spy;

      await executeWeeklyAudit(step as never, deps);

      expectCredsInStep(step, activeStepAtResolve, "audit-", 2);
      expect(step.stepNames.filter((n) => n.startsWith("audit-"))).toHaveLength(2);
    });

    it("returns early inside the audit step when creds are missing (no client, no report)", async () => {
      deps.getDeploymentCredentials = vi
        .fn()
        .mockResolvedValueOnce({ accessToken: "token", accountId: "act_123" })
        .mockResolvedValueOnce(null);

      await executeWeeklyAudit(step as never, deps);

      expect(deps.createAdsClient).toHaveBeenCalledTimes(1);
      expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
      expect(step.stepNames.some((n) => n.startsWith("creds-"))).toBe(false);
    });
  });

  describe("executeDailyCheck", () => {
    let deps: CronDependencies;
    let step: ReturnType<typeof makeMockStep>;

    beforeEach(() => {
      step = makeMockStep();
      deps = {
        listActiveDeployments: vi
          .fn()
          .mockResolvedValue([{ id: "dep-1", organizationId: "org-1", inputConfig: {} }]),
        createAdsClient: vi.fn().mockReturnValue({
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
        createCrmProvider: vi.fn(),
        createInsightsProvider: vi.fn(),
        saveAuditReport: vi.fn(),
        getDeploymentCredentials: vi
          .fn()
          .mockResolvedValue({ accessToken: "token", accountId: "act_123" }),
      };
    });

    it("never names a `creds-` step; resolves creds inside the check step", async () => {
      const { spy, activeStepAtResolve } = makeCredsProbe(step);
      deps.getDeploymentCredentials = spy;

      await executeDailyCheck(step as never, deps);

      expectCredsInStep(step, activeStepAtResolve, "check-", 1);
    });

    it("returns early inside the check step when creds are missing (no client built)", async () => {
      deps.getDeploymentCredentials = vi.fn().mockResolvedValue(null);

      await executeDailyCheck(step as never, deps);

      expect(deps.createAdsClient).not.toHaveBeenCalled();
      expect(step.stepNames.some((n) => n.startsWith("creds-"))).toBe(false);
    });
  });

  describe("executeDailySignalHealthCheck", () => {
    let deps: SignalHealthCronDependencies;
    let step: ReturnType<typeof makeMockStep>;

    beforeEach(() => {
      step = makeMockStep();
      deps = {
        listActiveDeployments: vi.fn().mockResolvedValue([
          { id: "dep-1", organizationId: "org-1", inputConfig: {} },
          { id: "dep-2", organizationId: "org-2", inputConfig: {} },
        ]),
        getDeploymentCredentials: vi
          .fn()
          .mockResolvedValue({ accessToken: "token", accountId: "act_123" }),
        getDeploymentPixelId: vi.fn().mockResolvedValue("px_1"),
        createSignalHealthChecker: vi.fn().mockReturnValue({
          getSignalHealthReport: vi.fn().mockResolvedValue({
            pixelId: "px_1",
            score: "yellow",
            breaches: [],
          }),
        }),
        saveSignalHealthReport: vi.fn().mockResolvedValue(undefined),
      };
    });

    it("never names a `creds-` step; resolves creds inside the signal-health step", async () => {
      const { spy, activeStepAtResolve } = makeCredsProbe(step);
      deps.getDeploymentCredentials = spy;

      await executeDailySignalHealthCheck(step as never, deps);

      expectCredsInStep(step, activeStepAtResolve, "signal-health-", 2);
    });

    it("returns early inside the signal-health step when creds are missing (no checker built)", async () => {
      deps.getDeploymentCredentials = vi.fn().mockResolvedValue(null);

      await executeDailySignalHealthCheck(step as never, deps);

      expect(deps.createSignalHealthChecker).not.toHaveBeenCalled();
      expect(deps.saveSignalHealthReport).not.toHaveBeenCalled();
      expect(step.stepNames.some((n) => n.startsWith("creds-"))).toBe(false);
    });
  });
});
