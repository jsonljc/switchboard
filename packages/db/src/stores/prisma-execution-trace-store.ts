import type { PrismaDbClient } from "../prisma-db.js";

// Define the trace interface locally to avoid circular dependency with @switchboard/core
// This matches SkillExecutionTrace from packages/core/src/skill-runtime/types.ts
interface ExecutionTraceInput {
  id: string;
  deploymentId: string;
  organizationId: string;
  skillSlug: string;
  skillVersion: string;
  trigger: string;
  sessionId: string;
  inputParametersHash: string;
  toolCalls: unknown[];
  governanceDecisions: unknown[];
  tokenUsage: { input: number; output: number };
  durationMs: number;
  turnCount: number;
  status: string;
  error?: string;
  responseSummary: string;
  linkedOutcomeId?: string;
  linkedOutcomeType?: string;
  linkedOutcomeResult?: string;
  writeCount: number;
  createdAt: Date;
}

export class PrismaExecutionTraceStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(trace: ExecutionTraceInput): Promise<void> {
    await this.prisma.executionTrace.create({
      data: {
        id: trace.id,
        deploymentId: trace.deploymentId,
        organizationId: trace.organizationId,
        skillSlug: trace.skillSlug,
        skillVersion: trace.skillVersion,
        trigger: trace.trigger,
        sessionId: trace.sessionId,
        inputParametersHash: trace.inputParametersHash,
        toolCalls: trace.toolCalls as never,
        governanceDecisions: trace.governanceDecisions as never,
        tokenUsage: trace.tokenUsage as never,
        durationMs: trace.durationMs,
        turnCount: trace.turnCount,
        status: trace.status,
        error: trace.error,
        responseSummary: trace.responseSummary,
        writeCount: trace.writeCount,
        createdAt: trace.createdAt,
      },
    });
  }

  async listByDeployment(
    orgId: string,
    deploymentId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<{ traces: ExecutionTraceInput[]; nextCursor?: string }> {
    const rows = await this.prisma.executionTrace.findMany({
      where: { organizationId: orgId, deploymentId },
      orderBy: { createdAt: "desc" },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > opts.limit;
    const traces = (hasMore ? rows.slice(0, opts.limit) : rows) as unknown as ExecutionTraceInput[];
    const nextCursor = hasMore ? traces[traces.length - 1]!.id : undefined;

    return { traces, nextCursor };
  }

  async findById(orgId: string, traceId: string): Promise<ExecutionTraceInput | null> {
    const row = await this.prisma.executionTrace.findFirst({
      where: { id: traceId, organizationId: orgId },
    });
    return row as unknown as ExecutionTraceInput | null;
  }

  async linkOutcome(
    traceId: string,
    outcome: { id: string; type: string; result: string },
  ): Promise<void> {
    await this.prisma.executionTrace.update({
      where: { id: traceId },
      data: {
        linkedOutcomeId: outcome.id,
        linkedOutcomeType: outcome.type,
        linkedOutcomeResult: outcome.result,
      },
    });
  }

  async countRecentFailures(deploymentId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return this.prisma.executionTrace.count({
      where: {
        deploymentId,
        status: { in: ["error", "budget_exceeded"] },
        createdAt: { gte: since },
      },
    });
  }

  async countWritesInWindow(deploymentId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    const rows = await this.prisma.executionTrace.findMany({
      where: {
        deploymentId,
        writeCount: { gt: 0 },
        createdAt: { gte: since },
      },
      select: { writeCount: true },
    });
    return rows.reduce((sum, r) => sum + r.writeCount, 0);
  }
}
