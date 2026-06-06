/**
 * The PR-2 producer-population proof: the REAL executeWeeklyAudit drives the REAL
 * AuditRunner -> arbitration -> sink -> the pause submitter MIRRORING the
 * production mechanism (the inngest.ts closure + contained-workflows
 * submitRileyPause: buildRileyPauseSubmitRequest -> REAL PlatformIngress.submit
 * with the SEEDED pause policies) -> parked lifecycle -> REAL approve -> the REAL
 * executor pauses the fake Meta client. Pins, end to end:
 *
 *   1. DEFAULT POSTURE: a deployment without pauseSelfExecutionEnabled (the real
 *      seeded default) self-submits NOTHING even with the submitter wired.
 *   2. FLAG ON: the audit parks exactly one pause (approvalRequired + the
 *      mutate:riley:<recId>:pause idempotency key + park truth returned), and a
 *      REAL approve drives the Meta PAUSED write.
 *   3. PRIMARY-ONLY: a healthy account (no pause primary) self-submits nothing.
 *   4. ENTITLEMENT: an unentitled org is an honest named skip (parked:false),
 *      and the audit completes without throwing.
 *   5. NO PERSISTED ID: an emitter that returns no id never dispatches.
 *
 * Fixture: spend 20000 / 50 conversions = CPA 400 = 4x the default 100 target,
 * with an 8-day daily breach window -> the engine co-emits add_creative + pause;
 * the same-campaign conflict penalty hits both while add_creative also carries
 * the resetsLearning penalty, so the arbitrator ranks the PAUSE primary
 * (pinned in audit-runner-handoff.test.ts). Evidence {320 clicks, 50 conv, 7d}
 * clears the RAISED execution floor {100, 10, 7}.
 */
import { describe, it, expect, vi } from "vitest";
import { respondToParkedLifecycle } from "@switchboard/core";
import { executeWeeklyAudit, type CronDependencies } from "@switchboard/ad-optimizer";
import type { RileyPauseSubmitter } from "@switchboard/ad-optimizer";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import {
  buildRileyPauseSubmitRequest,
  type RileyPauseSubmitInput,
} from "../services/workflows/riley-pause-submit-request.js";
import { buildPauseLifecycleWorld } from "./riley-pause-lifecycle-world.js";
import {
  ORG,
  RILEY_DEPLOYMENT_ID,
  makeInsight,
  makeAccountSummary,
  syntheticCrmProvider,
  syntheticInsightsProvider,
  step,
} from "./recommendation-handoff-harness.js";

interface ParkedPause {
  input: RileyPauseSubmitInput;
  res: SubmitWorkResponse | null;
  parked: boolean;
}

/** The pause-producing weekly window: CPA 400 (4x target) + strong evidence. */
function pauseAdsClient() {
  const current = [
    makeInsight({ campaignId: "camp-1", inlineLinkClicks: 320, conversions: 50, spend: 20_000 }),
  ];
  const previous = [
    makeInsight({ campaignId: "camp-1", inlineLinkClicks: 320, conversions: 50, spend: 20_000 }),
  ];
  return {
    getCampaignInsights: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(previous),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
}

/** The breach window that arms the pause leg (>= 7 daily periods above target). */
function breachInsightsProvider() {
  const provider = syntheticInsightsProvider();
  (provider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
    periodsAboveTarget: 8,
    granularity: "daily",
    isApproximate: false,
  });
  return provider;
}

/**
 * CronDependencies whose rileyPauseSubmitter MIRRORS the production mechanism
 * (inngest.ts closure -> contained-workflows submitRileyPause -> ingress.submit),
 * including the approvalRequired branch + park truth + entitlement named skip.
 */
function buildPauseCronDeps(args: {
  world: ReturnType<typeof buildPauseLifecycleWorld>;
  parked: ParkedPause[];
  pauseSelfExecutionEnabled?: boolean;
  emitterId?: string | null;
  adsClient?: ReturnType<typeof pauseAdsClient>;
  insightsProvider?: ReturnType<typeof breachInsightsProvider>;
}): CronDependencies {
  const rileyPauseSubmitter: RileyPauseSubmitter = async (candidate) => {
    const input: RileyPauseSubmitInput = {
      organizationId: candidate.organizationId,
      recommendationId: candidate.recommendationId,
      campaignId: candidate.campaignId,
      rationale: candidate.rationale,
      evidence: candidate.evidence,
    };
    const req = buildRileyPauseSubmitRequest(input, {
      deploymentId: candidate.deploymentId,
      skillSlug: "ad-optimizer",
    });
    if (!req) {
      args.parked.push({ input, res: null, parked: false });
      return { parked: false };
    }
    const res = await args.world.harness.ingress.submit(req);
    const parked = res.ok && "approvalRequired" in res && res.approvalRequired === true;
    args.parked.push({ input, res, parked });
    return { parked };
  };

  return {
    listActiveDeployments: async () => [
      {
        id: RILEY_DEPLOYMENT_ID,
        organizationId: ORG,
        inputConfig: {},
        ...(args.pauseSelfExecutionEnabled !== undefined
          ? { pauseSelfExecutionEnabled: args.pauseSelfExecutionEnabled }
          : {}),
      },
    ],
    getDeploymentCredentials: async () => ({ accessToken: "tok", accountId: "act-123" }),
    createAdsClient: () => args.adsClient ?? pauseAdsClient(),
    createCrmProvider: () => syntheticCrmProvider(),
    createInsightsProvider: () => args.insightsProvider ?? breachInsightsProvider(),
    saveAuditReport: async () => {},
    recommendationEmitter: async (input) =>
      args.emitterId === null
        ? { surface: "queue" }
        : { surface: "queue", id: args.emitterId ?? `rec_${input.action}` },
    rileyPauseSubmitter,
  };
}

describe("riley pause cron loop (real audit -> real ingress -> real approve -> Meta)", () => {
  it("DEFAULT POSTURE: flag absent = zero pause submits even with the submitter wired", async () => {
    const world = buildPauseLifecycleWorld();
    const parked: ParkedPause[] = [];
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildPauseCronDeps({ world, parked }),
    );
    expect(parked).toHaveLength(0);
    expect(world.harness.metaCalls).toHaveLength(0);
  });

  it("FLAG ON: parks exactly one pause with the seam idempotency key; approve pauses Meta", async () => {
    const world = buildPauseLifecycleWorld();
    const parked: ParkedPause[] = [];
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildPauseCronDeps({ world, parked, pauseSelfExecutionEnabled: true }),
    );

    expect(parked).toHaveLength(1);
    expect(parked[0]!.parked).toBe(true);
    expect(parked[0]!.input.campaignId).toBe("camp-1");
    const res = parked[0]!.res!;
    if (!res.ok) throw new Error("submit failed");
    expect(res.result.outcome).toBe("pending_approval");
    expect(res.workUnit.idempotencyKey).toBe(
      `mutate:riley:${parked[0]!.input.recommendationId}:pause`,
    );
    expect(world.harness.metaCalls).toHaveLength(0); // parked, not executed

    const lifecycleId = (res as { lifecycleId?: string }).lifecycleId!;
    const bindingHash = (res as { bindingHash?: string }).bindingHash!;
    const result = await respondToParkedLifecycle(world.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.executionResult?.success).toBe(true);
    expect(world.harness.metaCalls).toEqual([{ campaignId: "camp-1", status: "PAUSED" }]);
  });

  it("PRIMARY-ONLY: a healthy account (no pause primary) self-submits nothing", async () => {
    const world = buildPauseLifecycleWorld();
    const parked: ParkedPause[] = [];
    // Healthy fixture: default insights + no breach -> no pause recommendation at
    // all (and whatever primary exists is not a pause).
    const healthyAds = {
      getCampaignInsights: vi
        .fn()
        .mockResolvedValueOnce([makeInsight({})])
        .mockResolvedValueOnce([makeInsight({})]),
      getAdSetInsights: vi.fn().mockResolvedValue([]),
      getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
    };
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildPauseCronDeps({
        world,
        parked,
        pauseSelfExecutionEnabled: true,
        adsClient: healthyAds,
        insightsProvider: syntheticInsightsProvider() as ReturnType<typeof breachInsightsProvider>,
      }),
    );
    expect(parked).toHaveLength(0);
    expect(world.harness.metaCalls).toHaveLength(0);
  });

  it("ENTITLEMENT: an unentitled org is an honest named skip (parked false), audit completes", async () => {
    const world = buildPauseLifecycleWorld({
      entitlementResolver: {
        resolve: async () => ({ entitled: false, reason: "blocked", blockedStatus: "canceled" }),
      },
    });
    const parked: ParkedPause[] = [];
    await expect(
      executeWeeklyAudit(
        step as Parameters<typeof executeWeeklyAudit>[0],
        buildPauseCronDeps({ world, parked, pauseSelfExecutionEnabled: true }),
      ),
    ).resolves.not.toThrow();
    expect(parked).toHaveLength(1);
    expect(parked[0]!.parked).toBe(false);
    const res = parked[0]!.res!;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe("entitlement_required");
    expect(world.harness.metaCalls).toHaveLength(0);
  });

  it("NO PERSISTED ID: an emitter without ids never dispatches the pause submitter", async () => {
    const world = buildPauseLifecycleWorld();
    const parked: ParkedPause[] = [];
    await executeWeeklyAudit(
      step as Parameters<typeof executeWeeklyAudit>[0],
      buildPauseCronDeps({ world, parked, pauseSelfExecutionEnabled: true, emitterId: null }),
    );
    expect(parked).toHaveLength(0);
  });
});
