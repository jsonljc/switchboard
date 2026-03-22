import type { PrismaClient } from "@prisma/client";
import type { AgentSession, SessionStatus } from "@switchboard/schemas";
import type { SessionStore } from "@switchboard/core/sessions";

export class PrismaSessionStore implements SessionStore {
  constructor(private prisma: PrismaClient) {}

  async create(session: AgentSession): Promise<void> {
    await this.prisma.agentSession.create({
      data: {
        id: session.id,
        organizationId: session.organizationId,
        roleId: session.roleId,
        principalId: session.principalId,
        status: session.status,
        safetyEnvelope: session.safetyEnvelope as object,
        toolCallCount: session.toolCallCount,
        mutationCount: session.mutationCount,
        dollarsAtRisk: session.dollarsAtRisk,
        currentStep: session.currentStep,
        toolHistory: session.toolHistory as object[],
        checkpoint: session.checkpoint ? (session.checkpoint as object) : undefined,
        traceId: session.traceId,
        startedAt: session.startedAt,
        completedAt: session.completedAt ?? undefined,
      },
    });
  }

  async getById(id: string): Promise<AgentSession | null> {
    const row = await this.prisma.agentSession.findUnique({ where: { id } });
    if (!row) return null;
    return toAgentSession(row);
  }

  async update(id: string, updates: Partial<AgentSession>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.toolCallCount !== undefined) data.toolCallCount = updates.toolCallCount;
    if (updates.mutationCount !== undefined) data.mutationCount = updates.mutationCount;
    if (updates.dollarsAtRisk !== undefined) data.dollarsAtRisk = updates.dollarsAtRisk;
    if (updates.currentStep !== undefined) data.currentStep = updates.currentStep;
    if (updates.checkpoint !== undefined) data.checkpoint = updates.checkpoint as object;
    if (updates.completedAt !== undefined) data.completedAt = updates.completedAt;
    if (updates.toolHistory !== undefined) data.toolHistory = updates.toolHistory as object[];

    await this.prisma.agentSession.update({ where: { id }, data });
  }

  async list(filter: {
    organizationId?: string;
    roleId?: string;
    status?: SessionStatus;
    principalId?: string;
    limit?: number;
  }): Promise<AgentSession[]> {
    const where: Record<string, unknown> = {};
    if (filter.organizationId) where.organizationId = filter.organizationId;
    if (filter.roleId) where.roleId = filter.roleId;
    if (filter.status) where.status = filter.status;
    if (filter.principalId) where.principalId = filter.principalId;

    const rows = await this.prisma.agentSession.findMany({
      where,
      take: filter.limit ?? 100,
      orderBy: { startedAt: "desc" },
    });
    return rows.map(toAgentSession);
  }

  async countActive(filter: { organizationId: string; roleId?: string }): Promise<number> {
    const where: Record<string, unknown> = {
      organizationId: filter.organizationId,
      status: { in: ["running", "paused"] },
    };
    if (filter.roleId) where.roleId = filter.roleId;

    return this.prisma.agentSession.count({ where });
  }

  async createIfUnderLimit(session: AgentSession, maxConcurrent: number): Promise<boolean> {
    // Serializable transaction: atomically check count and insert
    return this.prisma.$transaction(
      async (tx) => {
        const activeCount = await tx.agentSession.count({
          where: {
            organizationId: session.organizationId,
            roleId: session.roleId,
            status: { in: ["running", "paused"] },
          },
        });

        if (activeCount >= maxConcurrent) return false;

        await tx.agentSession.create({
          data: {
            id: session.id,
            organizationId: session.organizationId,
            roleId: session.roleId,
            principalId: session.principalId,
            status: session.status,
            safetyEnvelope: session.safetyEnvelope as object,
            toolCallCount: session.toolCallCount,
            mutationCount: session.mutationCount,
            dollarsAtRisk: session.dollarsAtRisk,
            currentStep: session.currentStep,
            toolHistory: session.toolHistory as object[],
            checkpoint: session.checkpoint ? (session.checkpoint as object) : undefined,
            traceId: session.traceId,
            startedAt: session.startedAt,
            completedAt: session.completedAt ?? undefined,
          },
        });

        return true;
      },
      { isolationLevel: "Serializable" },
    );
  }
}

function toAgentSession(row: {
  id: string;
  organizationId: string;
  roleId: string;
  principalId: string;
  status: string;
  safetyEnvelope: unknown;
  toolCallCount: number;
  mutationCount: number;
  dollarsAtRisk: number;
  currentStep: number;
  toolHistory: unknown;
  checkpoint: unknown;
  traceId: string;
  startedAt: Date;
  completedAt: Date | null;
}): AgentSession {
  return {
    id: row.id,
    organizationId: row.organizationId,
    roleId: row.roleId,
    principalId: row.principalId,
    status: row.status as SessionStatus,
    safetyEnvelope: row.safetyEnvelope as AgentSession["safetyEnvelope"],
    toolCallCount: row.toolCallCount,
    mutationCount: row.mutationCount,
    dollarsAtRisk: row.dollarsAtRisk,
    currentStep: row.currentStep,
    toolHistory: (row.toolHistory ?? []) as AgentSession["toolHistory"],
    checkpoint: (row.checkpoint as AgentSession["checkpoint"]) ?? null,
    traceId: row.traceId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}
