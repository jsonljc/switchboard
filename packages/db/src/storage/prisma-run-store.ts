import type { PrismaClient } from "@prisma/client";
import type { AgentRun, RunTriggerType, RunOutcome } from "@switchboard/schemas";
import type { RunStore } from "@switchboard/core/sessions";

export class PrismaRunStore implements RunStore {
  constructor(private prisma: PrismaClient) {}

  async save(run: AgentRun): Promise<void> {
    await this.prisma.agentRun.create({
      data: {
        id: run.id,
        sessionId: run.sessionId,
        runIndex: run.runIndex,
        triggerType: run.triggerType,
        resumeContext: run.resumeContext ? (run.resumeContext as object) : undefined,
        outcome: run.outcome ?? undefined,
        stepRange: run.stepRange ? (run.stepRange as object) : undefined,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? undefined,
      },
    });
  }

  async getById(id: string): Promise<AgentRun | null> {
    const row = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!row) return null;
    return toAgentRun(row);
  }

  async update(id: string, updates: Partial<AgentRun>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.outcome !== undefined) data.outcome = updates.outcome;
    if (updates.stepRange !== undefined) data.stepRange = updates.stepRange as object;
    if (updates.completedAt !== undefined) data.completedAt = updates.completedAt;

    await this.prisma.agentRun.update({ where: { id }, data });
  }

  async listBySession(sessionId: string): Promise<AgentRun[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: { sessionId },
      orderBy: { runIndex: "asc" },
    });
    return rows.map(toAgentRun);
  }
}

function toAgentRun(row: {
  id: string;
  sessionId: string;
  runIndex: number;
  triggerType: string;
  resumeContext: unknown;
  outcome: string | null;
  stepRange: unknown;
  startedAt: Date;
  completedAt: Date | null;
}): AgentRun {
  return {
    id: row.id,
    sessionId: row.sessionId,
    runIndex: row.runIndex,
    triggerType: row.triggerType as RunTriggerType,
    resumeContext: (row.resumeContext as Record<string, unknown>) ?? null,
    outcome: (row.outcome as RunOutcome) ?? null,
    stepRange: (row.stepRange as AgentRun["stepRange"]) ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}
