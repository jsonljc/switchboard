import { describe, it, expect, vi } from "vitest";
import {
  buildGetApprovalState,
  buildMarkRecommendationActed,
  buildRileyPauseExecutorHandler,
} from "../riley-pause-executor.js";
import type {
  WorkTrace,
  WorkTraceReadResult,
  WorkUnit,
  WorkflowRuntimeServices,
} from "@switchboard/core/platform";

const services = {} as WorkflowRuntimeServices;

/** A WorkTrace read result carrying just the approval fields the closure reads. */
function approvedTraceRead(
  over: Partial<Pick<WorkTrace, "organizationId" | "approvalOutcome" | "approvalRespondedBy">>,
): WorkTraceReadResult {
  return {
    trace: {
      workUnitId: "wu_1",
      organizationId: "org_1",
      approvalOutcome: "approved",
      approvalRespondedBy: "user_owner",
      ...over,
    } as WorkTrace,
    integrity: { status: "ok" },
  };
}

/** Mock prismaClient driven through the REAL Prisma store classes the wiring
 * constructs (findUnique/findFirst delegates). */
function mockPrisma(opts?: { deployment?: { id: string; organizationId: string } | null }) {
  return {
    agentDeployment: {
      findUnique: vi.fn(async () =>
        opts?.deployment === undefined
          ? { id: "dep_riley", organizationId: "org_1" }
          : opts.deployment,
      ),
    },
    deploymentConnection: {
      findFirst: vi.fn(async () => null), // no meta-ads connection in these legs
    },
  };
}

/** Fake WorkTraceStore reader: an APPROVED, org-matching trace by default so the
 * existing org-isolation / no-connection legs run past the new last-mile gate. */
function fakeWorkTraceStore(read: WorkTraceReadResult | null = approvedTraceRead({})) {
  return { getByWorkUnitId: vi.fn(async () => read) };
}

function pauseWorkUnit(organizationId: string): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: new Date().toISOString(),
    organizationId,
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.campaign.pause",
    parameters: {
      recommendationId: "rec_1",
      actionType: "pause",
      campaignId: "camp_1",
      rationale: "r",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    },
    deployment: {
      deploymentId: "dep_riley",
      skillSlug: "ad-optimizer",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "t_1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

describe("buildRileyPauseExecutorHandler (bootstrap wiring)", () => {
  it("keys the handler to the live pause intent", async () => {
    const { intent } = await buildRileyPauseExecutorHandler(mockPrisma(), fakeWorkTraceStore());
    expect(intent).toBe("adoptimizer.campaign.pause");
  });

  it("org isolation: a deployment owned by another org fails LOUDLY before any credential read", async () => {
    const prisma = mockPrisma({ deployment: { id: "dep_riley", organizationId: "org_OTHER" } });
    const { handler } = await buildRileyPauseExecutorHandler(prisma, fakeWorkTraceStore());
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });

  it("org isolation: a VANISHED deployment maps to the same loud failure (safe direction)", async () => {
    const prisma = mockPrisma({ deployment: null });
    const { handler } = await buildRileyPauseExecutorHandler(prisma, fakeWorkTraceStore());
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
  });

  it("no meta-ads connection on the org's own deployment fails honestly", async () => {
    const prisma = mockPrisma();
    const { handler } = await buildRileyPauseExecutorHandler(prisma, fakeWorkTraceStore());
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("NO_META_CONNECTION");
    expect(prisma.deploymentConnection.findFirst).toHaveBeenCalledWith({
      where: { deploymentId: "dep_riley", type: "meta-ads" },
    });
  });

  it("wires the last-mile gate: an UNAPPROVED work unit fails closed before any deployment/credential read", async () => {
    const prisma = mockPrisma();
    const { handler } = await buildRileyPauseExecutorHandler(
      prisma,
      fakeWorkTraceStore(approvedTraceRead({ approvalOutcome: undefined })),
    );
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("PAUSE_NOT_APPROVED");
    expect(prisma.agentDeployment.findUnique).not.toHaveBeenCalled();
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });
});

describe("buildGetApprovalState (last-mile WorkTrace read closure)", () => {
  it("returns the durable approval outcome for an org-matching trace", async () => {
    const store = fakeWorkTraceStore(
      approvedTraceRead({ approvalOutcome: "approved", approvalRespondedBy: "user_owner" }),
    );
    const getApprovalState = buildGetApprovalState(store);
    const state = await getApprovalState({ organizationId: "org_1", workUnitId: "wu_1" });
    expect(state).toEqual({ approvalOutcome: "approved", approvalRespondedBy: "user_owner" });
    expect(store.getByWorkUnitId).toHaveBeenCalledWith("wu_1");
  });

  it("treats a DIFFERENT-tenant trace as not approved (never reads another org's approval)", async () => {
    const store = fakeWorkTraceStore(
      approvedTraceRead({ organizationId: "org_OTHER", approvalOutcome: "approved" }),
    );
    const getApprovalState = buildGetApprovalState(store);
    const state = await getApprovalState({ organizationId: "org_1", workUnitId: "wu_1" });
    expect(state.approvalOutcome).toBeUndefined();
  });

  it("treats a missing trace as not approved (fail closed)", async () => {
    const store = fakeWorkTraceStore(null);
    const getApprovalState = buildGetApprovalState(store);
    const state = await getApprovalState({ organizationId: "org_1", workUnitId: "wu_missing" });
    expect(state.approvalOutcome).toBeUndefined();
  });
});

describe("buildMarkRecommendationActed (slice 4f closure)", () => {
  it("maps recommendationId to the row id and supplies the machine sentinel", async () => {
    const markActedByExecution = vi.fn(
      async (_args: {
        id: string;
        organizationId: string;
        executableWorkUnitId: string;
        resolvedBy: string;
        executedAt: Date;
      }) => ({ transitioned: true as const }),
    );
    const dep = buildMarkRecommendationActed({ markActedByExecution });
    const executedAt = new Date("2026-06-07T03:30:00Z");
    await dep({
      organizationId: "org_1",
      recommendationId: "rec_9",
      executableWorkUnitId: "wu_9",
      executedAt,
    });
    expect(markActedByExecution).toHaveBeenCalledWith({
      id: "rec_9",
      organizationId: "org_1",
      executableWorkUnitId: "wu_9",
      resolvedBy: "riley_self_execution",
      executedAt,
    });
  });
});
