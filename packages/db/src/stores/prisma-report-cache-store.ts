import type { PrismaClient } from "@prisma/client";
import type { ReportCacheRow, ReportCacheStore } from "@switchboard/core/reports";
import type { ReportDataV1 } from "@switchboard/schemas";

type Prisma = Pick<PrismaClient, "reportCache">;

export function createPrismaReportCacheStore(prisma: Prisma): ReportCacheStore {
  return {
    async findByKey(organizationId: string, window: string) {
      const row = await prisma.reportCache.findUnique({
        where: { organizationId_window: { organizationId, window } },
      });
      if (!row) return null;
      return {
        organizationId: row.organizationId,
        window: row.window,
        payload: row.payload as unknown as ReportDataV1,
        computedAt: row.computedAt,
        expiresAt: row.expiresAt,
      } satisfies ReportCacheRow;
    },
    async upsert(row: ReportCacheRow) {
      await prisma.reportCache.upsert({
        where: {
          organizationId_window: { organizationId: row.organizationId, window: row.window },
        },
        update: {
          payload: row.payload as never,
          computedAt: row.computedAt,
          expiresAt: row.expiresAt,
        },
        create: {
          organizationId: row.organizationId,
          window: row.window,
          payload: row.payload as never,
          computedAt: row.computedAt,
          expiresAt: row.expiresAt,
        },
      });
    },
    async invalidate(organizationId: string, window: string) {
      await prisma.reportCache.deleteMany({ where: { organizationId, window } });
    },
  };
}
