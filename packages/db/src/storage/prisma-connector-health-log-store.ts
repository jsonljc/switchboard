// ---------------------------------------------------------------------------
// PrismaConnectorHealthLogStore — Prisma-backed connector health log
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

interface ConnectorHealthLogEntry {
  id: string;
  organizationId: string;
  connectorId: string;
  connectorName: string;
  status: string;
  matchRate: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

export class PrismaConnectorHealthLogStore {
  constructor(private prisma: PrismaClient) {}

  async log(entry: Omit<ConnectorHealthLogEntry, "id" | "checkedAt">): Promise<void> {
    await this.prisma.connectorHealthLog.create({
      data: {
        organizationId: entry.organizationId,
        connectorId: entry.connectorId,
        connectorName: entry.connectorName,
        status: entry.status,
        matchRate: entry.matchRate,
        errorMessage: entry.errorMessage,
      },
    });
  }

  async getLatest(
    organizationId: string,
    connectorId: string,
  ): Promise<ConnectorHealthLogEntry | null> {
    const row = await this.prisma.connectorHealthLog.findFirst({
      where: { organizationId, connectorId },
      orderBy: { checkedAt: "desc" },
    });
    if (!row) return null;
    return toEntry(row);
  }

  async listByOrg(organizationId: string): Promise<ConnectorHealthLogEntry[]> {
    // Get the latest log per connector for this org
    const rows = await this.prisma.connectorHealthLog.findMany({
      where: { organizationId },
      orderBy: { checkedAt: "desc" },
    });

    // Deduplicate — keep only the latest per connectorId
    const seen = new Set<string>();
    const result: ConnectorHealthLogEntry[] = [];
    for (const row of rows) {
      if (!seen.has(row.connectorId)) {
        seen.add(row.connectorId);
        result.push(toEntry(row));
      }
    }
    return result;
  }
}

function toEntry(row: {
  id: string;
  organizationId: string;
  connectorId: string;
  connectorName: string;
  status: string;
  matchRate: number | null;
  errorMessage: string | null;
  checkedAt: Date;
}): ConnectorHealthLogEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    connectorId: row.connectorId,
    connectorName: row.connectorName,
    status: row.status,
    matchRate: row.matchRate,
    errorMessage: row.errorMessage,
    checkedAt: row.checkedAt.toISOString(),
  };
}
