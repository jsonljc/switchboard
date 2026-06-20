import type { PrismaDbClient } from "../prisma-db.js";
import { StaleVersionError } from "@switchboard/core";

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
  workUnitId?: string;
  inputParametersHash: string;
  toolCalls: unknown[];
  governanceDecisions: unknown[];
  tokenUsage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
    costUsd?: number;
    model?: string;
  };
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
        workUnitId: trace.workUnitId,
        inputParametersHash: trace.inputParametersHash,
        toolCalls: trace.toolCalls as never,
        governanceDecisions: trace.governanceDecisions as never,
        tokenUsage: trace.tokenUsage as never,
        durationMs: trace.durationMs,
        turnCount: trace.turnCount,
        status: trace.status,
        error: trace.error,
        responseSummary: trace.responseSummary,
        linkedOutcomeId: trace.linkedOutcomeId,
        linkedOutcomeType: trace.linkedOutcomeType,
        linkedOutcomeResult: trace.linkedOutcomeResult,
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

  /**
   * The execution traces for one work unit, ordered chronologically (S6a query surface).
   * Each row's `toolCalls` is the ordered ToolCallRecord[] sequence (LLM turn order),
   * so a consumer (trajectory grading / OTel spans) can join the tool-call trajectory
   * to its WorkTrace. Tenant-scoped by organizationId. Empty array when none match
   * (e.g. legacy rows persisted before the workUnitId column, which carry NULL).
   */
  async findByWorkUnitId(orgId: string, workUnitId: string): Promise<ExecutionTraceInput[]> {
    const rows = await this.prisma.executionTrace.findMany({
      where: { organizationId: orgId, workUnitId },
      orderBy: { createdAt: "asc" },
    });
    return rows as unknown as ExecutionTraceInput[];
  }

  async linkOutcome(
    organizationId: string,
    traceId: string,
    outcome: { id: string; type: string; result: string },
  ): Promise<void> {
    const result = await this.prisma.executionTrace.updateMany({
      where: { id: traceId, organizationId },
      data: {
        linkedOutcomeId: outcome.id,
        linkedOutcomeType: outcome.type,
        linkedOutcomeResult: outcome.result,
      },
    });
    if (result.count === 0) throw new StaleVersionError(traceId, -1, -1);
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
