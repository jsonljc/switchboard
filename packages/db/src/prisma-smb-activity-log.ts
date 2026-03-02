import type { PrismaClient } from "@prisma/client";
import type { ActivityLogStorage, ActivityLogEntry, ActivityLogQuery } from "@switchboard/core";

export class PrismaSmbActivityLogStorage implements ActivityLogStorage {
  constructor(private prisma: PrismaClient) {}

  async append(entry: ActivityLogEntry): Promise<void> {
    await (this.prisma as any).smbActivityLogEntry.create({
      data: {
        id: entry.id,
        timestamp: entry.timestamp,
        actorId: entry.actorId,
        actorType: entry.actorType,
        actionType: entry.actionType,
        result: entry.result,
        amount: entry.amount,
        summary: entry.summary,
        snapshot: entry.snapshot as any,
        envelopeId: entry.envelopeId,
        organizationId: entry.organizationId,
        redactionApplied: entry.redactionApplied,
        redactedFields: entry.redactedFields,
      },
    });
  }

  async query(filter: ActivityLogQuery): Promise<ActivityLogEntry[]> {
    const where: any = {
      organizationId: filter.organizationId,
    };

    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.actionType) where.actionType = filter.actionType;
    if (filter.result) where.result = filter.result;
    if (filter.envelopeId) where.envelopeId = filter.envelopeId;
    if (filter.after || filter.before) {
      where.timestamp = {};
      if (filter.after) where.timestamp.gte = filter.after;
      if (filter.before) where.timestamp.lt = filter.before;
    }

    const rows = await (this.prisma as any).smbActivityLogEntry.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: filter.offset ?? 0,
      take: filter.limit ?? 50,
    });

    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      actorId: row.actorId,
      actorType: row.actorType,
      actionType: row.actionType,
      result: row.result,
      amount: row.amount,
      summary: row.summary,
      snapshot: row.snapshot as Record<string, unknown>,
      envelopeId: row.envelopeId,
      organizationId: row.organizationId,
      redactionApplied: row.redactionApplied,
      redactedFields: row.redactedFields,
    }));
  }
}
