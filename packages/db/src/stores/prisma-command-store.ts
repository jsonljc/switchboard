import type { PrismaClient } from "@prisma/client";
import type {
  OperatorRequest,
  OperatorCommand,
  CommandStatus,
  GuardrailResult,
  CommandEntity,
} from "@switchboard/schemas";
import type { OperatorCommandStore } from "@switchboard/core";

type CommandRow = Awaited<
  ReturnType<PrismaClient["operatorCommandRecord"]["findUniqueOrThrow"]>
>;

export class PrismaOperatorCommandStore implements OperatorCommandStore {
  constructor(private readonly prisma: PrismaClient) {}

  async saveRequest(request: OperatorRequest): Promise<void> {
    await this.prisma.operatorRequestRecord.create({
      data: {
        id: request.id,
        organizationId: request.organizationId,
        operatorId: request.operatorId,
        channel: request.channel,
        rawInput: request.rawInput,
        receivedAt: request.receivedAt,
      },
    });
  }

  async saveCommand(command: OperatorCommand): Promise<void> {
    await this.prisma.operatorCommandRecord.create({
      data: {
        id: command.id,
        requestId: command.requestId,
        organizationId: command.organizationId,
        intent: command.intent,
        entities: command.entities as unknown as Parameters<
          PrismaClient["operatorCommandRecord"]["create"]
        >[0]["data"]["entities"],
        parameters: command.parameters as unknown as Parameters<
          PrismaClient["operatorCommandRecord"]["create"]
        >[0]["data"]["parameters"],
        parseConfidence: command.parseConfidence,
        guardrailResult: command.guardrailResult as unknown as Parameters<
          PrismaClient["operatorCommandRecord"]["create"]
        >[0]["data"]["guardrailResult"],
        status: command.status,
        workflowIds: command.workflowIds as unknown as Parameters<
          PrismaClient["operatorCommandRecord"]["create"]
        >[0]["data"]["workflowIds"],
        resultSummary: command.resultSummary,
        completedAt: command.completedAt,
      },
    });
  }

  async updateCommandStatus(
    commandId: string,
    status: CommandStatus,
    updates?: Partial<Pick<OperatorCommand, "resultSummary" | "completedAt" | "workflowIds">>,
  ): Promise<void> {
    await this.prisma.operatorCommandRecord.update({
      where: { id: commandId },
      data: {
        status,
        ...(updates?.resultSummary !== undefined ? { resultSummary: updates.resultSummary } : {}),
        ...(updates?.completedAt !== undefined ? { completedAt: updates.completedAt } : {}),
        ...(updates?.workflowIds !== undefined
          ? {
              workflowIds: updates.workflowIds as unknown as Parameters<
                PrismaClient["operatorCommandRecord"]["update"]
              >[0]["data"]["workflowIds"],
            }
          : {}),
      },
    });
  }

  async getCommandById(commandId: string): Promise<OperatorCommand | null> {
    const row = await this.prisma.operatorCommandRecord.findUnique({
      where: { id: commandId },
    });
    return row ? this.toCommand(row) : null;
  }

  async listCommands(filters: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }): Promise<OperatorCommand[]> {
    const rows = await this.prisma.operatorCommandRecord.findMany({
      where: { organizationId: filters.organizationId },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    });
    return rows.map((r) => this.toCommand(r));
  }

  async getRequestById(requestId: string): Promise<OperatorRequest | null> {
    const row = await this.prisma.operatorRequestRecord.findUnique({
      where: { id: requestId },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      operatorId: row.operatorId,
      channel: row.channel as OperatorRequest["channel"],
      rawInput: row.rawInput,
      receivedAt: row.receivedAt,
    };
  }

  private toCommand(row: CommandRow): OperatorCommand {
    return {
      id: row.id,
      requestId: row.requestId,
      organizationId: row.organizationId,
      intent: row.intent,
      entities: row.entities as unknown as CommandEntity[],
      parameters: row.parameters as Record<string, unknown>,
      parseConfidence: row.parseConfidence,
      guardrailResult: row.guardrailResult as unknown as GuardrailResult,
      status: row.status as CommandStatus,
      workflowIds: row.workflowIds as unknown as string[],
      resultSummary: row.resultSummary ?? null,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? null,
    };
  }
}
