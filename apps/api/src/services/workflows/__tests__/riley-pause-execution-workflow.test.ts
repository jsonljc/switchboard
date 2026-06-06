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
    now: () => NOW,
  };
  return { deps, updateCampaignStatus, getCampaignStatus };
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
  });

  it("fails LOUDLY when the deployment belongs to another org (security signal, not a skip)", async () => {
    const h = harness({ creds: "org_mismatch" });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
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
  });

  it("proceeds with previousStatus unknown when the status read degrades (the write is the honest test)", async () => {
    const h = harness({ campaignStatus: null });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: true, previousStatus: "unknown" });
    expect(h.updateCampaignStatus).toHaveBeenCalledTimes(1);
  });

  it("fails honestly when the org has no meta-ads connection", async () => {
    const h = harness({ creds: null });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("NO_META_CONNECTION");
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
  });
});
