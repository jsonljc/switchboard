import { describe, it, expect, vi } from "vitest";
import { buildRileyPauseExecutorHandler } from "../riley-pause-executor.js";
import type { WorkUnit, WorkflowRuntimeServices } from "@switchboard/core/platform";

const services = {} as WorkflowRuntimeServices;

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
    const { intent } = await buildRileyPauseExecutorHandler(mockPrisma());
    expect(intent).toBe("adoptimizer.campaign.pause");
  });

  it("org isolation: a deployment owned by another org fails LOUDLY before any credential read", async () => {
    const prisma = mockPrisma({ deployment: { id: "dep_riley", organizationId: "org_OTHER" } });
    const { handler } = await buildRileyPauseExecutorHandler(prisma);
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(prisma.deploymentConnection.findFirst).not.toHaveBeenCalled();
  });

  it("org isolation: a VANISHED deployment maps to the same loud failure (safe direction)", async () => {
    const prisma = mockPrisma({ deployment: null });
    const { handler } = await buildRileyPauseExecutorHandler(prisma);
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
  });

  it("no meta-ads connection on the org's own deployment fails honestly", async () => {
    const prisma = mockPrisma();
    const { handler } = await buildRileyPauseExecutorHandler(prisma);
    const result = await handler.execute(pauseWorkUnit("org_1"), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("NO_META_CONNECTION");
    expect(prisma.deploymentConnection.findFirst).toHaveBeenCalledWith({
      where: { deploymentId: "dep_riley", type: "meta-ads" },
    });
  });
});
