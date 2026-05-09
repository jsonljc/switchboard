import type { PrismaClient } from "@prisma/client";
import type { ScheduledTrigger, TriggerFilters, TriggerStatus } from "@switchboard/schemas";
import type { TriggerStore, TriggerBrowseQuery, TriggerBrowseResult } from "@switchboard/core";

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

export class PrismaTriggerStore implements TriggerStore {
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

  async expireOverdue(now: Date): Promise<number> {
    const result = await this.prisma.scheduledTriggerRecord.updateMany({
      where: {
        status: "active",
        expiresAt: { lt: now },
      },
      data: { status: "expired" },
    });
    return result.count;
  }

  async listForBrowse(query: TriggerBrowseQuery): Promise<TriggerBrowseResult> {
    const { orgId, status, direction, cursor, limit } = query;

    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;
    if (cursor) {
      // Strict keyset pagination: row must come *after* the cursor in sort
      // direction. (createdAt, id) tuple comparison.
      if (direction === "desc") {
        where.OR = [
          { createdAt: { lt: cursor.ts } },
          { createdAt: cursor.ts, id: { lt: cursor.id } },
        ];
      } else {
        where.OR = [
          { createdAt: { gt: cursor.ts } },
          { createdAt: cursor.ts, id: { gt: cursor.id } },
        ];
      }
    }

    const orderBy =
      direction === "desc"
        ? [{ createdAt: "desc" as const }, { id: "desc" as const }]
        : [{ createdAt: "asc" as const }, { id: "asc" as const }];

    const [records, grouped] = await Promise.all([
      this.prisma.scheduledTriggerRecord.findMany({
        where,
        orderBy,
        take: limit + 1,
      }),
      this.prisma.scheduledTriggerRecord.groupBy({
        by: ["status"],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
    ]);

    const counts = { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 };
    for (const g of grouped) {
      const n = g._count._all;
      counts.all += n;
      if (g.status === "active") counts.active = n;
      else if (g.status === "fired") counts.fired = n;
      else if (g.status === "cancelled") counts.cancelled = n;
      else if (g.status === "expired") counts.expired = n;
    }

    return {
      rows: records.map((r) => toScheduledTrigger(r as PrismaRecord)),
      statusCounts: counts,
    };
  }
}
