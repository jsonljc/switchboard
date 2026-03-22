import type { ToolEvent } from "@switchboard/schemas";
import type { ToolEventStore } from "@switchboard/core/sessions";
import type { PrismaDbClient } from "../prisma-db.js";

export class PrismaToolEventStore implements ToolEventStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(event: ToolEvent): Promise<void> {
    await this.prisma.toolEvent.create({
      data: {
        id: event.id,
        sessionId: event.sessionId,
        runId: event.runId,
        stepIndex: event.stepIndex,
        toolName: event.toolName,
        parameters: event.parameters as object,
        result: event.result ? (event.result as object) : undefined,
        isMutation: event.isMutation,
        dollarsAtRisk: event.dollarsAtRisk,
        durationMs: event.durationMs ?? undefined,
        envelopeId: event.envelopeId ?? undefined,
        timestamp: event.timestamp,
        gatewayIdempotencyKey: event.gatewayIdempotencyKey ?? undefined,
      },
    });
  }

  async findByGatewayIdempotencyKey(
    sessionId: string,
    gatewayIdempotencyKey: string,
  ): Promise<ToolEvent | null> {
    const row = await this.prisma.toolEvent.findFirst({
      where: { sessionId, gatewayIdempotencyKey },
    });
    return row ? toToolEvent(row) : null;
  }

  async listBySession(sessionId: string): Promise<ToolEvent[]> {
    const rows = await this.prisma.toolEvent.findMany({
      where: { sessionId },
      orderBy: { stepIndex: "asc" },
    });
    return rows.map(toToolEvent);
  }

  async listByRun(runId: string): Promise<ToolEvent[]> {
    const rows = await this.prisma.toolEvent.findMany({
      where: { runId },
      orderBy: { stepIndex: "asc" },
    });
    return rows.map(toToolEvent);
  }

  async countBySession(
    sessionId: string,
  ): Promise<{ totalCalls: number; mutations: number; dollarsAtRisk: number }> {
    const [totalCalls, mutationCount, dollarSum] = await Promise.all([
      this.prisma.toolEvent.count({ where: { sessionId } }),
      this.prisma.toolEvent.count({ where: { sessionId, isMutation: true } }),
      this.prisma.toolEvent.aggregate({
        where: { sessionId },
        _sum: { dollarsAtRisk: true },
      }),
    ]);

    return {
      totalCalls,
      mutations: mutationCount,
      dollarsAtRisk: dollarSum._sum.dollarsAtRisk ?? 0,
    };
  }
}

function toToolEvent(row: {
  id: string;
  sessionId: string;
  runId: string;
  stepIndex: number;
  toolName: string;
  parameters: unknown;
  result: unknown;
  isMutation: boolean;
  dollarsAtRisk: number;
  durationMs: number | null;
  envelopeId: string | null;
  timestamp: Date;
  gatewayIdempotencyKey: string | null;
}): ToolEvent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    stepIndex: row.stepIndex,
    toolName: row.toolName,
    parameters: row.parameters as Record<string, unknown>,
    result: (row.result as Record<string, unknown>) ?? null,
    isMutation: row.isMutation,
    dollarsAtRisk: row.dollarsAtRisk,
    durationMs: row.durationMs,
    envelopeId: row.envelopeId,
    timestamp: row.timestamp,
    ...(row.gatewayIdempotencyKey ? { gatewayIdempotencyKey: row.gatewayIdempotencyKey } : {}),
  };
}
