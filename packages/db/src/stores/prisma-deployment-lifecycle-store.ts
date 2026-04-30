import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  DeploymentLifecycleStore,
  HaltAllInput,
  HaltAllResult,
  ResumeInput,
  ResumeResult,
  SuspendAllInput,
  SuspendAllResult,
  WorkTrace,
} from "@switchboard/core/platform";
import type { PrismaWorkTraceStore } from "./prisma-work-trace-store.js";

export class PrismaDeploymentLifecycleStore implements DeploymentLifecycleStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workTraceStore: PrismaWorkTraceStore,
  ) {}

  async haltAll(input: HaltAllInput): Promise<HaltAllResult> {
    const requestedAt = new Date();
    const executionStartedAt = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const before = await tx.agentDeployment.findMany({
        where: { organizationId: input.organizationId, status: "active" },
        select: { id: true },
      });
      const ids = before.map((r) => r.id);

      const updateResult = await tx.agentDeployment.updateMany({
        where: { organizationId: input.organizationId, status: "active" },
        data: { status: "paused" },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "agent_deployment.halt",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "agent_deployment.halt",
          orgId: input.organizationId,
          before: { status: "active", ids },
          after: { status: "paused", count: updateResult.count },
          reason: input.reason,
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `operator ${input.operator.id} halted ${updateResult.count} deployment(s) for org ${input.organizationId}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, ids, count: updateResult.count };
    });

    const completedAt = new Date();
    const finalize = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "DeploymentLifecycleStore.haltAll" },
    );
    if (!finalize.ok) {
      console.warn(
        `[deployment-lifecycle-store] haltAll finalize rejected for ${txResult.workUnitId}: ${finalize.reason}`,
      );
    }

    return {
      workTraceId: txResult.workUnitId,
      affectedDeploymentIds: txResult.ids,
      count: txResult.count,
    };
  }

  async resume(input: ResumeInput): Promise<ResumeResult> {
    const requestedAt = new Date();
    const executionStartedAt = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const before = await tx.agentDeployment.findMany({
        where: {
          organizationId: input.organizationId,
          skillSlug: input.skillSlug,
          status: "paused",
        },
        select: { id: true },
      });
      const ids = before.map((r) => r.id);

      const updateResult = await tx.agentDeployment.updateMany({
        where: {
          organizationId: input.organizationId,
          skillSlug: input.skillSlug,
          status: "paused",
        },
        data: { status: "active" },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "agent_deployment.resume",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "agent_deployment.resume",
          orgId: input.organizationId,
          skillSlug: input.skillSlug,
          before: { status: "paused", ids },
          after: { status: "active", count: updateResult.count },
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `operator ${input.operator.id} resumed ${updateResult.count} ${input.skillSlug} deployment(s) for org ${input.organizationId}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, ids, count: updateResult.count };
    });

    const completedAt = new Date();
    const finalize = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "DeploymentLifecycleStore.resume" },
    );
    if (!finalize.ok) {
      console.warn(
        `[deployment-lifecycle-store] resume finalize rejected for ${txResult.workUnitId}: ${finalize.reason}`,
      );
    }

    return {
      workTraceId: txResult.workUnitId,
      affectedDeploymentIds: txResult.ids,
      count: txResult.count,
    };
  }

  async suspendAll(_input: SuspendAllInput): Promise<SuspendAllResult> {
    throw new Error("not implemented yet — see Task 4");
  }
}
