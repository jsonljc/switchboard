import type { PrismaClient } from "@prisma/client";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";

type PrismaRecord = {
  id: string;
  organizationId: string;
  type: string;
  fireAt: Date | null;
  cronExpression: string | null;
  eventPattern: unknown;
  action: unknown;
  sourceWorkflowId: string | null;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
};

function toScheduledTrigger(record: PrismaRecord): ScheduledTrigger {
  return {
    id: record.id,
    organizationId: record.organizationId,
    type: record.type as ScheduledTrigger["type"],
    fireAt: record.fireAt,
    cronExpression: record.cronExpression,
    eventPattern: record.eventPattern as ScheduledTrigger["eventPattern"],
    action: record.action as ScheduledTrigger["action"],
    sourceWorkflowId: record.sourceWorkflowId,
    status: record.status as ScheduledTrigger["status"],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export class PrismaTriggerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(trigger: ScheduledTrigger): Promise<void> {
    await this.prisma.scheduledTriggerRecord.create({
      data: {
        id: trigger.id,
        organizationId: trigger.organizationId,
        type: trigger.type,
        fireAt: trigger.fireAt,
        cronExpression: trigger.cronExpression,
        eventPattern: trigger.eventPattern as object | undefined,
        action: trigger.action as object,
        sourceWorkflowId: trigger.sourceWorkflowId,
        status: trigger.status,
        createdAt: trigger.createdAt,
        expiresAt: trigger.expiresAt,
      },
    });
  }

  async findById(id: string): Promise<ScheduledTrigger | null> {
    const record = await this.prisma.scheduledTriggerRecord.findUnique({
      where: { id },
    });
    return record ? toScheduledTrigger(record as PrismaRecord) : null;
  }

  async findByFilters(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
    const where: Record<string, unknown> = {};
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.sourceWorkflowId) where.sourceWorkflowId = filters.sourceWorkflowId;

    const records = await this.prisma.scheduledTriggerRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return records.map((r) => toScheduledTrigger(r as PrismaRecord));
  }

  async updateStatus(id: string, status: TriggerStatus): Promise<void> {
    await this.prisma.scheduledTriggerRecord.update({
      where: { id },
      data: { status },
    });
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.prisma.scheduledTriggerRecord.deleteMany({
      where: {
        expiresAt: { lt: before },
        status: { in: ["fired", "cancelled", "expired"] },
      },
    });
    return result.count;
  }
}
