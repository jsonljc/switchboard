import type { PrismaClient } from "@prisma/client";
import type { AuditEntry } from "@switchboard/schemas";
import type { LedgerStorage, AuditQueryFilter } from "@switchboard/core";

export class PrismaLedgerStorage implements LedgerStorage {
  constructor(private prisma: PrismaClient) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.prisma.auditEntry.create({
      data: {
        id: entry.id,
        eventType: entry.eventType,
        timestamp: entry.timestamp,
        actorType: entry.actorType,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        riskCategory: entry.riskCategory,
        visibilityLevel: entry.visibilityLevel,
        summary: entry.summary,
        snapshot: entry.snapshot as object,
        evidencePointers: entry.evidencePointers as object[],
        redactionApplied: entry.redactionApplied,
        redactedFields: entry.redactedFields,
        chainHashVersion: entry.chainHashVersion,
        schemaVersion: entry.schemaVersion,
        entryHash: entry.entryHash,
        previousEntryHash: entry.previousEntryHash,
        envelopeId: entry.envelopeId,
        organizationId: entry.organizationId,
      },
    });
  }

  async getLatest(): Promise<AuditEntry | null> {
    const row = await this.prisma.auditEntry.findFirst({
      orderBy: { timestamp: "desc" },
    });
    if (!row) return null;
    return toAuditEntry(row);
  }

  async getById(id: string): Promise<AuditEntry | null> {
    const row = await this.prisma.auditEntry.findUnique({ where: { id } });
    if (!row) return null;
    return toAuditEntry(row);
  }

  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    const where: Record<string, unknown> = {};

    if (filter.eventType) where["eventType"] = filter.eventType;
    if (filter.entityType) where["entityType"] = filter.entityType;
    if (filter.entityId) where["entityId"] = filter.entityId;
    if (filter.envelopeId) where["envelopeId"] = filter.envelopeId;
    if (filter.organizationId) where["organizationId"] = filter.organizationId;

    if (filter.after || filter.before) {
      const timestampFilter: Record<string, Date> = {};
      if (filter.after) timestampFilter["gt"] = filter.after;
      if (filter.before) timestampFilter["lt"] = filter.before;
      where["timestamp"] = timestampFilter;
    }

    const rows = await this.prisma.auditEntry.findMany({
      where,
      orderBy: { timestamp: "asc" },
      take: filter.limit,
    });

    return rows.map(toAuditEntry);
  }
}

function toAuditEntry(row: {
  id: string;
  eventType: string;
  timestamp: Date;
  actorType: string;
  actorId: string;
  entityType: string;
  entityId: string;
  riskCategory: string;
  visibilityLevel: string;
  summary: string;
  snapshot: unknown;
  evidencePointers: unknown;
  redactionApplied: boolean;
  redactedFields: string[];
  chainHashVersion: number;
  schemaVersion: number;
  entryHash: string;
  previousEntryHash: string | null;
  envelopeId: string | null;
  organizationId: string | null;
}): AuditEntry {
  return {
    id: row.id,
    eventType: row.eventType as AuditEntry["eventType"],
    timestamp: row.timestamp,
    actorType: row.actorType as AuditEntry["actorType"],
    actorId: row.actorId,
    entityType: row.entityType,
    entityId: row.entityId,
    riskCategory: row.riskCategory as AuditEntry["riskCategory"],
    visibilityLevel: row.visibilityLevel as AuditEntry["visibilityLevel"],
    summary: row.summary,
    snapshot: row.snapshot as Record<string, unknown>,
    evidencePointers: row.evidencePointers as AuditEntry["evidencePointers"],
    redactionApplied: row.redactionApplied,
    redactedFields: row.redactedFields,
    chainHashVersion: row.chainHashVersion,
    schemaVersion: row.schemaVersion,
    entryHash: row.entryHash,
    previousEntryHash: row.previousEntryHash,
    envelopeId: row.envelopeId,
    organizationId: row.organizationId,
  };
}
