import type { PrismaDbClient } from "../prisma-db.js";
import type { ReportCacheStore, ReportCacheRow } from "@switchboard/core/reports";
import type { ReportDataV1 } from "@switchboard/schemas";

export class PrismaReportCacheStore implements ReportCacheStore {
  constructor(private prisma: PrismaDbClient) {}

  async findByKey(orgId: string, window: string): Promise<ReportCacheRow | null> {
    const row = await this.prisma.reportCache.findUnique({
      where: {
        organizationId_window: { organizationId: orgId, window },
      },
    });
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      window: row.window,
      payload: row.payload as unknown as ReportDataV1,
      computedAt: row.computedAt,
      expiresAt: row.expiresAt,
    };
  }

  async upsert(row: ReportCacheRow): Promise<void> {
    await this.prisma.reportCache.upsert({
      where: {
        organizationId_window: {
          organizationId: row.organizationId,
          window: row.window,
        },
      },
      create: {
        organizationId: row.organizationId,
        window: row.window,
        payload: row.payload as object,
        computedAt: row.computedAt,
        expiresAt: row.expiresAt,
      },
      update: {
        payload: row.payload as object,
        computedAt: row.computedAt,
        expiresAt: row.expiresAt,
      },
    });
  }

  async invalidate(orgId: string, window: string): Promise<void> {
    await this.prisma.reportCache.deleteMany({
      where: { organizationId: orgId, window },
    });
  }
}
