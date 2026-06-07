import { describe, it, expect, vi } from "vitest";
import {
  buildRileyPauseExecutionWorkflow,
  RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS,
} from "../riley-pause-execution-workflow.js";
import type { WorkUnit, WorkflowRuntimeServices } from "@switchboard/core/platform";

const services = {} as WorkflowRuntimeServices; // executor never submits child work

const NOW = new Date("2026-06-06T12:00:00.000Z");

function workUnit(overrides?: {
  parameters?: Record<string, unknown>;
  requestedAt?: string;
  organizationId?: string;
}): WorkUnit {
  return {
    id: "wu_pause_1",
    requestedAt: overrides?.requestedAt ?? "2026-06-06T11:00:00.000Z", // 1h old
    organizationId: overrides?.organizationId ?? "org_1",
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.campaign.pause",
    parameters: overrides?.parameters ?? {
      recommendationId: "rec_1",
      actionType: "pause",
      campaignId: "camp_1",
      rationale: "spend with zero booked revenue",
      evidence: { clicks: 100, conversions: 10, days: 7 },
    },
    deployment: {
      deploymentId: "dep_riley",
      skillSlug: "ad-optimizer",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace_1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function harness(overrides?: {
  creds?: { accessToken: string; accountId: string } | null | "org_mismatch";
  campaignStatus?: { status: string; effectiveStatus: string } | null;
  updateCampaignStatus?: ReturnType<typeof vi.fn>;
  markRecommendationActed?: ReturnType<typeof vi.fn>;
}) {
  const updateCampaignStatus =
    overrides?.updateCampaignStatus ?? vi.fn().mockResolvedValue(undefined);
  const getCampaignStatus = vi
    .fn()
    .mockResolvedValue(
      overrides?.campaignStatus === undefined
        ? { status: "ACTIVE", effectiveStatus: "ACTIVE" }
        : overrides.campaignStatus,
    );
  const markRecommendationActed =
    overrides?.markRecommendationActed ??
    vi.fn(
      async (_args: {
        organizationId: string;
        recommendationId: string;
        executableWorkUnitId: string;
        executedAt: Date;
      }) => ({ transitioned: true as const }),
    );
  const deps = {
    getDeploymentCredentials: vi.fn(async (organizationId: string, _deploymentId: string) => {
      if (overrides?.creds === "org_mismatch") {
        return { kind: "org_mismatch" as const };
      }
      if (overrides?.creds === null) return { kind: "none" as const };
      void organizationId;
      return {
        kind: "ok" as const,
        credentials: overrides?.creds ?? { accessToken: "tok", accountId: "act_1" },
      };
    }),
    createAdsClient: vi.fn().mockReturnValue({ updateCampaignStatus, getCampaignStatus }),
    markRecommendationActed,
    now: () => NOW,
  };
  return { deps, updateCampaignStatus, getCampaignStatus, markRecommendationActed };
}

describe("riley pause execution workflow", () => {
  it("pauses the campaign on Meta and records execution truth + seam declarations", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(h.updateCampaignStatus).toHaveBeenCalledTimes(1);
    expect(h.updateCampaignStatus).toHaveBeenCalledWith("camp_1", "PAUSED");
    expect(result.outputs).toMatchObject({
      paused: true,
      campaignId: "camp_1",
      recommendationId: "rec_1",
      previousStatus: "ACTIVE",
      newStatus: "PAUSED",
      metaWriteAccepted: true,
      requestedAt: "2026-06-06T11:00:00.000Z",
      ageHours: 1,
    });
    expect((result.outputs as { rollbackPlan: string }).rollbackPlan).toMatch(
      /Resume the campaign/,
    );
    expect(typeof (result.outputs as { successMetric: string }).successMetric).toBe("string");
    expect(Array.isArray((result.outputs as { guardrailMetrics: string[] }).guardrailMetrics)).toBe(
      true,
    );
  });

  it("fails closed on invalid parameters (no Meta call)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(
      workUnit({ parameters: { recommendationId: "rec_1" } }),
      services,
    );
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("INVALID_PAUSE_INPUT");
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("abstains below the execution floor (completed no-op, never a phantom pause)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(
      workUnit({
        parameters: {
          recommendationId: "rec_1",
          actionType: "pause",
          campaignId: "camp_1",
          rationale: "thin evidence",
          evidence: { clicks: 50, conversions: 5, days: 7 },
        },
      }),
      services,
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: false,
      skipped: true,
      reason: "below_execution_floor",
    });
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("does not pause when the approval is stale (requestedAt older than the cap)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const staleAt = new Date(
      NOW.getTime() - (RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    const result = await handler.execute(workUnit({ requestedAt: staleAt }), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: false,
      skipped: true,
      reason: "stale_approval",
      requestedAt: staleAt,
    });
    expect((result.outputs as { ageHours: number }).ageHours).toBeGreaterThan(
      RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS,
    );
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("executes at just under the age cap (boundary)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const freshEnough = new Date(
      NOW.getTime() - (RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS - 1) * 60 * 60 * 1000,
    ).toISOString();
    const result = await handler.execute(workUnit({ requestedAt: freshEnough }), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: true });
    expect(h.markRecommendationActed).toHaveBeenCalledTimes(1);
  });

  it("fails LOUDLY when the deployment belongs to another org (security signal, not a skip)", async () => {
    const h = harness({ creds: "org_mismatch" });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("does not pause when the campaign is already paused (records previousStatus)", async () => {
    const h = harness({ campaignStatus: { status: "PAUSED", effectiveStatus: "PAUSED" } });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: false,
      skipped: true,
      reason: "campaign_already_paused",
      previousStatus: "PAUSED",
    });
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("does not pause a deleted/archived campaign (not pausable)", async () => {
    const h = harness({ campaignStatus: { status: "DELETED", effectiveStatus: "DELETED" } });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: false,
      skipped: true,
      reason: "campaign_not_pausable",
    });
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("proceeds with previousStatus unknown when the status read degrades (the write is the honest test)", async () => {
    const h = harness({ campaignStatus: null });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: true, previousStatus: "unknown" });
    expect(h.updateCampaignStatus).toHaveBeenCalledTimes(1);
    expect(h.markRecommendationActed).toHaveBeenCalledTimes(1);
  });

  it("fails honestly when the org has no meta-ads connection", async () => {
    const h = harness({ creds: null });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("NO_META_CONNECTION");
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });

  it("fails honestly when the Meta write throws (drives recovery_required upstream)", async () => {
    const h = harness({
      updateCampaignStatus: vi.fn().mockRejectedValue(new Error("Meta API error (500): boom")),
    });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("META_PAUSE_FAILED");
    expect(result.error?.message).toContain("boom");
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });
});

describe("slice 4f: recommendation transition on the truthful success leg ONLY", () => {
  it("transitions after a real Meta write: exact args, execution-time anchor, outputs truth", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(h.markRecommendationActed).toHaveBeenCalledTimes(1);
    expect(h.markRecommendationActed).toHaveBeenCalledWith({
      organizationId: "org_1",
      recommendationId: "rec_1",
      executableWorkUnitId: "wu_pause_1",
      executedAt: NOW,
    });
    expect(result.outputs).toMatchObject({
      paused: true,
      metaWriteAccepted: true,
      recommendationTransition: "acted",
      executedAt: NOW.toISOString(),
    });
  });

  it("anchors on the execution clock even when requestedAt is ~47h stale (within the cap)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const staleButValid = new Date(NOW.getTime() - 47 * 60 * 60 * 1000).toISOString();
    await handler.execute(workUnit({ requestedAt: staleButValid }), services);
    const call = h.markRecommendationActed.mock.calls[0]![0] as { executedAt: Date };
    expect(call.executedAt).toEqual(NOW); // NOT requestedAt
  });

  it("a benign lost race (not_pending) preserves the success result and records it", async () => {
    const h = harness({
      markRecommendationActed: vi.fn(async (_args: { recommendationId: string }) => ({
        transitioned: false as const,
        reason: "not_pending" as const,
      })),
    });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: true,
      metaWriteAccepted: true,
      recommendationTransition: "not_pending",
    });
  });

  it("records not_found DISTINCTLY from not_pending", async () => {
    const h = harness({
      markRecommendationActed: vi.fn(async (_args: { recommendationId: string }) => ({
        transitioned: false as const,
        reason: "not_found" as const,
      })),
    });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ recommendationTransition: "not_found" });
  });

  it("a thrown transition error never fails the work unit, and is LOUD (greppable console.error)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const h = harness({
        markRecommendationActed: vi.fn(async (_args: { recommendationId: string }) => {
          throw new Error("db down");
        }),
      });
      const handler = buildRileyPauseExecutionWorkflow(h.deps);
      const result = await handler.execute(workUnit(), services);
      expect(result.outcome).toBe("completed");
      expect(result.outputs).toMatchObject({
        paused: true,
        metaWriteAccepted: true,
        recommendationTransition: "error",
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const line = String(errorSpy.mock.calls[0]![0]);
      expect(line).toContain("[riley-pause] failed to mark recommendation acted");
      expect(line).toContain("rec_1");
      expect(line).toContain("wu_pause_1");
      expect(line).toContain("db down");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("already-paused pre-read skip NEVER transitions (no spend change from THIS work unit)", async () => {
    const h = harness({ campaignStatus: { status: "PAUSED", effectiveStatus: "PAUSED" } });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    await handler.execute(workUnit(), services);
    expect(h.markRecommendationActed).not.toHaveBeenCalled();
  });
});
