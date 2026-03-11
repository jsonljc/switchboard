import type { PrismaClient, Prisma } from "@prisma/client";
import type { ActivityLogStorage, ActivityLogEntry, ActivityLogQuery } from "@switchboard/core";

export class PrismaSmbActivityLogStorage implements ActivityLogStorage {
  constructor(private prisma: PrismaClient) {}

  async append(entry: ActivityLogEntry): Promise<void> {
    await this.prisma.smbActivityLogEntry.create({
      data: {
        id: entry.id,
        timestamp: entry.timestamp,
        actorId: entry.actorId,
        actorType: entry.actorType,
        actionType: entry.actionType,
        result: entry.result,
        amount: entry.amount,
        summary: entry.summary,
        snapshot: entry.snapshot as Prisma.InputJsonValue,
        envelopeId: entry.envelopeId,
        organizationId: entry.organizationId,
        redactionApplied: entry.redactionApplied,
        redactedFields: entry.redactedFields,
      },
    });
  }

  async query(filter: ActivityLogQuery): Promise<ActivityLogEntry[]> {
    const rows = await this.prisma.smbActivityLogEntry.findMany({
      where: {
        organizationId: filter.organizationId,
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
        ...(filter.actionType ? { actionType: filter.actionType } : {}),
        ...(filter.result ? { result: filter.result } : {}),
        ...(filter.envelopeId ? { envelopeId: filter.envelopeId } : {}),
        ...((filter.after || filter.before) && {
          timestamp: {
            ...(filter.after ? { gte: filter.after } : {}),
            ...(filter.before ? { lt: filter.before } : {}),
          },
        }),
      },
      orderBy: { timestamp: "desc" },
      skip: filter.offset ?? 0,
      take: filter.limit ?? 50,
    });

    return rows.map((row) => ({
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
