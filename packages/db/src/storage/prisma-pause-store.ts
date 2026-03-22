import type { AgentPause, ResumeStatus } from "@switchboard/schemas";
import type { PauseStore } from "@switchboard/core/sessions";
import type { PrismaDbClient } from "../prisma-db.js";

export class PrismaPauseStore implements PauseStore {
  constructor(private prisma: PrismaDbClient) {}

  async save(pause: AgentPause): Promise<void> {
    await this.prisma.agentPause.create({
      data: {
        id: pause.id,
        sessionId: pause.sessionId,
        runId: pause.runId,
        pauseIndex: pause.pauseIndex,
        approvalId: pause.approvalId,
        resumeStatus: pause.resumeStatus,
        resumeToken: pause.resumeToken,
        checkpoint: pause.checkpoint as object,
        approvalOutcome: pause.approvalOutcome ? (pause.approvalOutcome as object) : undefined,
        createdAt: pause.createdAt,
        resumedAt: pause.resumedAt ?? undefined,
      },
    });
  }

  async getById(id: string): Promise<AgentPause | null> {
    const row = await this.prisma.agentPause.findUnique({ where: { id } });
    if (!row) return null;
    return toAgentPause(row);
  }

  async getByApprovalId(approvalId: string): Promise<AgentPause | null> {
    const row = await this.prisma.agentPause.findUnique({ where: { approvalId } });
    if (!row) return null;
    return toAgentPause(row);
  }

  async update(id: string, updates: Partial<AgentPause>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.resumeStatus !== undefined) data.resumeStatus = updates.resumeStatus;
    if (updates.approvalOutcome !== undefined)
      data.approvalOutcome = updates.approvalOutcome as object;
    if (updates.resumedAt !== undefined) data.resumedAt = updates.resumedAt;

    await this.prisma.agentPause.update({ where: { id }, data });
  }

  async listBySession(sessionId: string): Promise<AgentPause[]> {
    const rows = await this.prisma.agentPause.findMany({
      where: { sessionId },
      orderBy: { pauseIndex: "asc" },
    });
    return rows.map(toAgentPause);
  }

  async compareAndSwapResumeStatus(
    id: string,
    expectedStatus: ResumeStatus,
    newStatus: ResumeStatus,
    updates?: Partial<AgentPause>,
  ): Promise<boolean> {
    const data: Record<string, unknown> = { resumeStatus: newStatus };
    if (updates?.approvalOutcome !== undefined)
      data.approvalOutcome = updates.approvalOutcome as object;
    if (updates?.resumedAt !== undefined) data.resumedAt = updates.resumedAt;

    const result = await this.prisma.agentPause.updateMany({
      where: { id, resumeStatus: expectedStatus },
      data,
    });

    return result.count === 1;
  }
}

function toAgentPause(row: {
  id: string;
  sessionId: string;
  runId: string;
  pauseIndex: number;
  approvalId: string;
  resumeStatus: string;
  resumeToken: string;
  checkpoint: unknown;
  approvalOutcome: unknown;
  createdAt: Date;
  resumedAt: Date | null;
}): AgentPause {
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    pauseIndex: row.pauseIndex,
    approvalId: row.approvalId,
    resumeStatus: row.resumeStatus as ResumeStatus,
    resumeToken: row.resumeToken,
    checkpoint: row.checkpoint as AgentPause["checkpoint"],
    approvalOutcome: (row.approvalOutcome as Record<string, unknown>) ?? null,
    createdAt: row.createdAt,
    resumedAt: row.resumedAt,
  };
}
