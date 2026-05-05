import type { PrismaClient } from "@prisma/client";
import type { BaselineRow, BaselineStore } from "@switchboard/core/reports";

type Prisma = Pick<PrismaClient, "preSwitchboardBaseline">;

export function createPrismaBaselineStore(prisma: Prisma): BaselineStore {
  return {
    async listByDimension(organizationId: string, dimension: BaselineRow["dimension"]) {
      const rows = await prisma.preSwitchboardBaseline.findMany({
        where: { organizationId, dimension },
        orderBy: [{ metric: "asc" }, { periodStart: "asc" }],
      });
      return rows.map((r) => ({
        organizationId: r.organizationId,
        dimension: r.dimension as BaselineRow["dimension"],
        metric: r.metric,
        value: r.value,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        capturedAt: r.capturedAt,
      }));
    },
    async insertMany(incoming: BaselineRow[]) {
      for (const row of incoming) {
        await prisma.preSwitchboardBaseline.upsert({
          where: {
            id:
              row.organizationId +
              "::" +
              row.dimension +
              "::" +
              row.metric +
              "::" +
              row.periodStart.toISOString() +
              "::" +
              row.periodEnd.toISOString(),
          },
          update: { value: row.value, capturedAt: row.capturedAt },
          create: {
            id:
              row.organizationId +
              "::" +
              row.dimension +
              "::" +
              row.metric +
              "::" +
              row.periodStart.toISOString() +
              "::" +
              row.periodEnd.toISOString(),
            organizationId: row.organizationId,
            dimension: row.dimension,
            metric: row.metric,
            value: row.value,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            capturedAt: row.capturedAt,
          },
        });
      }
    },
  };
}
