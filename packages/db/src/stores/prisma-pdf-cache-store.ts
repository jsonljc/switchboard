import type { PrismaClient } from "@prisma/client";
import type { PdfCacheRow, PdfCacheStore } from "@switchboard/core/reports";

type Prisma = Pick<PrismaClient, "pdfCache">;

export function createPrismaPdfCacheStore(prisma: Prisma): PdfCacheStore {
  return {
    async findByKey(organizationId: string, window: string) {
      const row = await prisma.pdfCache.findUnique({
        where: { organizationId_window: { organizationId, window } },
      });
      if (!row) return null;
      return {
        organizationId: row.organizationId,
        window: row.window,
        pdfBytes: new Uint8Array(row.pdfBytes),
        computedAt: row.computedAt,
        expiresAt: row.expiresAt,
      } satisfies PdfCacheRow;
    },
    async upsert(row: PdfCacheRow) {
      const buf = Buffer.from(row.pdfBytes);
      await prisma.pdfCache.upsert({
        where: {
          organizationId_window: { organizationId: row.organizationId, window: row.window },
        },
        update: { pdfBytes: buf, computedAt: row.computedAt, expiresAt: row.expiresAt },
        create: {
          organizationId: row.organizationId,
          window: row.window,
          pdfBytes: buf,
          computedAt: row.computedAt,
          expiresAt: row.expiresAt,
        },
      });
    },
    async invalidate(organizationId: string, window: string) {
      await prisma.pdfCache.deleteMany({ where: { organizationId, window } });
    },
  };
}
